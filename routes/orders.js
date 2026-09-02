const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const { protect, adminOnly } = require('../middleware/auth');
const cache = require('../utils/cache');

// POST /api/orders - Place order
// Prices and the total are recomputed from the database. Previously the whole
// body was spread in, so a client could post totalAmount:0 or paymentStatus:'paid'.
router.post('/', protect, async (req, res) => {
  try {
    const { items, shippingAddress, paymentMethod, notes } = req.body;
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
    // A retried or double-tapped checkout must not become two orders. If this
    // key has been seen, hand back the order it already produced.
    const idempotencyKey = typeof req.body.idempotencyKey === 'string'
      ? req.body.idempotencyKey.trim().slice(0, 100)
      : undefined;

    if (idempotencyKey) {
      const existing = await Order.findOne({ idempotencyKey, user: req.user._id });
      if (existing) return res.status(200).json(existing);
    }

    /**
     * ── Stock, atomically ────────────────────────────────────────────────
     *
     * Stock was previously never read and never written: two members could buy
     * the last item and both succeed, and the count never moved.
     *
     * Each decrement is a single conditional update — `stock: { $gte: qty }`
     * in the filter with `$inc` in the update — so the check and the write are
     * one atomic operation. Two concurrent buyers cannot both pass it; the
     * loser matches no document and gets a clean out-of-stock error.
     *
     * The whole thing runs in a transaction so a multi-item order either takes
     * every item or none. Without it, failing on item three would leave items
     * one and two already decremented for an order that was never created.
     */
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
          // paymentStatus / orderStatus intentionally omitted — schema defaults apply
        }], { session });
        order = created;
      });
    } catch (err) {
      // A racing request with the same key wins the unique index; return its order.
      if (err?.code === 11000 && idempotencyKey) {
        const existing = await Order.findOne({ idempotencyKey, user: req.user._id });
        if (existing) return res.status(200).json(existing);
      }
      if (err?.status === 409) return res.status(409).json({ message: err.message });
      throw err;
    } finally {
      await session.endSession();
    }

    // Invalidate analytics + this member's orders cache
    cache.delPattern('analytics:');
    cache.del(`orders:member:${req.user._id}`);
    cache.del('orders:admin');
    cache.delPattern('store:');          // stock changed, so product lists are stale
    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/orders/my - User's own orders
router.get('/my', protect, async (req, res) => {
  try {
    const key = `orders:member:${req.user._id}`;
    const orders = await cache.getOrSet(key, 60, () =>
      Order.find({ user: req.user._id }).sort({ createdAt: -1 }).lean()
    );
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/orders - Admin: all orders
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const orders = await cache.getOrSet('orders:admin', 60, () =>
      Order.find().populate('user', 'name email phone').sort({ createdAt: -1 }).lean()
    );
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/orders/:id/status - Admin updates status
router.put('/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const update = {};
    if (req.body.orderStatus  !== undefined) update.orderStatus  = req.body.orderStatus;
    if (req.body.paymentStatus !== undefined) update.paymentStatus = req.body.paymentStatus;

    const before = await Order.findById(req.params.id);
    if (!before) return res.status(404).json({ message: 'Order not found' });

    /**
     * Cancelling returns the items to stock — but only once.
     *
     * `stockRestored` is flipped inside the same transaction as the $inc, and
     * the filter requires it to still be false. An admin clicking Cancel twice,
     * or a retried request, therefore matches nothing the second time and
     * cannot inflate stock. Without that guard, re-saving a cancelled order
     * would keep handing inventory back.
     */
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
          // Someone else already restored it; leave stock alone.
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
    // Bust the individual member's order cache too
    if (order?.user) cache.del(`orders:member:${order.user}`);
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
