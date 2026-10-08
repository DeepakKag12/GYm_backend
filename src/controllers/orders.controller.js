const mongoose = require('mongoose');
const Order = require('../models/Order.model');
const Product = require('../models/Product.model');
const SiteSettings = require('../models/SiteSettings.model');
const cache = require('../utils/cache');
const asyncHandler = require('../utils/asyncHandler');
const { sendDbError } = require('../utils/dbError');
const { buildOrderInvoice } = require('../utils/memberStatement');

// POST /api/orders - Place order
const placeOrder = asyncHandler(async (req, res) => {
  try {
    const { items, shippingAddress, notes } = req.body;
    let paymentMethod = (req.body.paymentMethod || 'cod').toString().toLowerCase();
    if (paymentMethod === 'cash_on_delivery') paymentMethod = 'cod';

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one item' });
    }

    const ids = items.map(i => i.product).filter(Boolean);
    if (ids.length !== items.length) {
      return res.status(400).json({ message: 'Every item must reference a product' });
    }
    const products = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
    const byId = new Map(products.map(p => [p._id.toString(), p]));

    const priced = [];
    for (const item of items) {
      const p = byId.get(String(item.product));
      if (!p) return res.status(400).json({ message: `Product unavailable: ${item.product}` });
      const qty = Math.floor(Number(item.quantity));
      if (!Number.isFinite(qty) || qty < 1) {
        return res.status(400).json({ message: `Invalid quantity for ${p.name}` });
      }
      // Trust the server's price, never the client's
      const unitPrice = p.discountPrice > 0 ? p.discountPrice : p.price;
      priced.push({
        product: p._id,
        name:    p.name,
        price:   unitPrice,
        quantity: qty,
        flavor:  item.flavor,
        weight:  item.weight,
        image:   p.images?.[0] || '',
      });
    }
    const totalAmount = priced.reduce((sum, i) => sum + i.price * i.quantity, 0);

    // ── Idempotency ────────────────────────────────────────────────────────
    const idempotencyKey = typeof req.body.idempotencyKey === 'string'
      ? req.body.idempotencyKey.trim().slice(0, 100)
      : undefined;

    if (idempotencyKey) {
      const existing = await Order.findOne({ idempotencyKey, user: req.user._id });
      if (existing) return res.status(200).json(existing);
    }

    const session = await mongoose.startSession();
    let order;
    try {
      await session.withTransaction(async () => {
        for (const item of priced) {
          const updated = await Product.findOneAndUpdate(
            { _id: item.product, isActive: true, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity } },
            { session, new: true },
          );
          if (!updated) {
            const err = new Error(`${item.name} does not have ${item.quantity} left in stock.`);
            err.status = 409;
            throw err;
          }
        }

        const [created] = await Order.create([{
          user: req.user._id,
          items: priced,
          shippingAddress,
          paymentMethod,
          notes,
          totalAmount,
          idempotencyKey,
        }], { session });
        order = created;
      });
    } catch (err) {
      if (err?.code === 11000 && idempotencyKey) {
        const existing = await Order.findOne({ idempotencyKey, user: req.user._id });
        if (existing) return res.status(200).json(existing);
      }
      if (err?.status === 409) return res.status(409).json({ message: err.message });
      throw err;
    } finally {
      await session.endSession();
    }

    cache.delPattern('analytics:');
    cache.del(`orders:member:${req.user._id}`);
    cache.del('orders:admin');
    cache.delPattern('store:');
    res.status(201).json(order);
  } catch (err) {
    sendDbError(res, err);
  }
});

// GET /api/orders/my - User's own orders
const getMyOrders = asyncHandler(async (req, res) => {
  try {
    const key = `orders:member:${req.user._id}`;
    const orders = await cache.getOrSet(key, 60, () =>
      Order.find({ user: req.user._id }).sort({ createdAt: -1 }).lean()
    );
    res.json(orders);
  } catch (err) {
    sendDbError(res, err);
  }
});

// GET /api/orders - Admin: all orders
const getAllOrders = asyncHandler(async (req, res) => {
  try {
    const orders = await cache.getOrSet('orders:admin', 60, () =>
      Order.find().populate('user', 'name email phone').sort({ createdAt: -1 }).lean()
    );
    res.json(orders);
  } catch (err) {
    sendDbError(res, err);
  }
});

// PUT /api/orders/:id/status - Admin updates status
const updateOrderStatus = asyncHandler(async (req, res) => {
  try {
    const update = {};
    if (req.body.orderStatus  !== undefined) update.orderStatus  = req.body.orderStatus;
    if (req.body.paymentStatus !== undefined) update.paymentStatus = req.body.paymentStatus;

    const before = await Order.findById(req.params.id);
    if (!before) return res.status(404).json({ message: 'Order not found' });

    const cancelling = update.orderStatus === 'cancelled' && before.orderStatus !== 'cancelled';
    let order;

    if (cancelling && !before.stockRestored) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const claimed = await Order.findOneAndUpdate(
            { _id: before._id, stockRestored: { $ne: true } },
            { $set: { ...update, stockRestored: true } },
            { session, new: true },
          );
          if (!claimed) { order = await Order.findById(before._id).session(session); return; }

          for (const item of claimed.items) {
            if (!item.product) continue;
            await Product.updateOne(
              { _id: item.product },
              { $inc: { stock: item.quantity } },
              { session },
            );
          }
          order = claimed;
        });
      } finally {
        await session.endSession();
      }
      cache.delPattern('store:');
    } else {
      order = await Order.findByIdAndUpdate(req.params.id, update, { new: true });
      if (!order) return res.status(404).json({ message: 'Order not found' });
    }
    cache.delPattern('analytics:');
    cache.del('orders:admin');
    if (order?.user) cache.del(`orders:member:${order.user}`);
    res.json(order);
  } catch (err) {
    sendDbError(res, err);
  }
});

// GET /api/orders/:id/invoice - stream order invoice PDF (view / download)
const getOrderInvoice = asyncHandler(async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'name email phone').lean();
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (req.user.role !== 'admin' && String(order.user?._id || order.user) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Access denied: You cannot view this invoice' });
    }
    const settings = await SiteSettings.getSettings().catch(() => null);
    const pdf = await buildOrderInvoice(order, order.user, settings);
    const filename = `order-invoice-${order._id.toString().slice(-6)}.pdf`;
    const isDownload = req.query.download === '1' || req.query.download === 'true';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${isDownload ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
      'Content-Length': pdf.length,
      'Cache-Control': 'no-store',
    });
    res.end(pdf);
  } catch (err) {
    sendDbError(res, err, 'Could not generate order invoice.');
  }
});

module.exports = {
  placeOrder,
  getMyOrders,
  getAllOrders,
  updateOrderStatus,
  getOrderInvoice,
};
