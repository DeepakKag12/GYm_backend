const mongoose = require('mongoose');
const { Message, getConversationId } = require('../models/Message.model');
const User = require('../models/User.model');
const { emitToUser, getOnlineUserIds } = require('../socket');
const cache = require('../utils/cache');

/**
 * Get distinct conversations for the logged-in user with last message and unread count
 */
const getConversations = async (req, res) => {
  try {
    const currentUserId = req.user._id;

    // Aggregate latest message for each distinct conversation
    const conversations = await Message.aggregate([
      {
        $match: {
          $or: [
            { sender: currentUserId },
            { recipient: currentUserId },
          ],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$conversationId',
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$recipient', currentUserId] },
                    { $eq: ['$isRead', false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { 'lastMessage.createdAt': -1 } },
    ]);

    // Find the other participant in each conversation
    const counterpartIds = conversations.map(c => {
      const msg = c.lastMessage;
      return String(msg.sender) === String(currentUserId) ? msg.recipient : msg.sender;
    });

    const users = await User.find({ _id: { $in: counterpartIds } })
      .select('name email role avatar specialization phone')
      .lean();

    const userMap = new Map(users.map(u => [String(u._id), u]));
    const onlineIds = new Set(getOnlineUserIds());

    const result = conversations.map(c => {
      const otherId = String(c.lastMessage.sender) === String(currentUserId)
        ? String(c.lastMessage.recipient)
        : String(c.lastMessage.sender);
      const participant = userMap.get(otherId) || { _id: otherId, name: 'User' };

      return {
        conversationId: c._id,
        participant: {
          ...participant,
          isOnline: onlineIds.has(otherId),
        },
        lastMessage: {
          _id: c.lastMessage._id,
          text: c.lastMessage.text,
          sender: c.lastMessage.sender,
          createdAt: c.lastMessage.createdAt,
          isRead: c.lastMessage.isRead,
        },
        unreadCount: c.unreadCount,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('getConversations error:', err);
    res.status(500).json({ message: 'Error loading conversations' });
  }
};

/**
 * Get messages between current user and specified recipient
 */
const getMessages = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { userId: otherUserId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const conversationId = getConversationId(currentUserId, otherUserId);
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const messages = await Message.find({ conversationId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('sender', 'name email role avatar')
      .populate('recipient', 'name email role avatar')
      .lean();

    // Mark received unread messages as read
    const markResult = await Message.updateMany(
      { conversationId, recipient: currentUserId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    if (markResult.modifiedCount > 0) {
      emitToUser(otherUserId, 'messages_read', {
        conversationId,
        readerId: currentUserId,
        readAt: new Date(),
      });
      cache.del(`chat:unread:${currentUserId}`);
    }

    // Return in chronological order
    res.json(messages.reverse());
  } catch (err) {
    console.error('getMessages error:', err);
    res.status(500).json({ message: 'Error loading messages' });
  }
};

/**
 * Send a message via REST API (with socket emission fallback)
 */
const sendMessage = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { recipientId, text, attachments = [] } = req.body;

    if (!recipientId || !text || !text.trim()) {
      return res.status(400).json({ message: 'Recipient and message text are required.' });
    }

    if (!mongoose.Types.ObjectId.isValid(recipientId)) {
      return res.status(400).json({ message: 'Invalid recipient ID' });
    }

    const recipient = await User.findById(recipientId).select('name email role avatar').lean();
    if (!recipient) {
      return res.status(404).json({ message: 'Recipient not found' });
    }

    const conversationId = getConversationId(currentUserId, recipientId);

    const messageDoc = await Message.create({
      conversationId,
      sender: currentUserId,
      recipient: recipientId,
      text: text.trim(),
      attachments,
    });

    const populated = await Message.findById(messageDoc._id)
      .populate('sender', 'name email role avatar')
      .populate('recipient', 'name email role avatar')
      .lean();

    // Emit real-time events to both participants
    emitToUser(currentUserId, 'new_message', populated);
    emitToUser(recipientId, 'new_message', populated);

    const conversationUpdate = {
      conversationId,
      lastMessage: populated,
      senderId: currentUserId,
      recipientId,
    };
    emitToUser(currentUserId, 'conversation_updated', conversationUpdate);
    emitToUser(recipientId, 'conversation_updated', conversationUpdate);

    cache.del(`chat:unread:${recipientId}`);

    res.status(201).json(populated);
  } catch (err) {
    console.error('sendMessage error:', err);
    res.status(500).json({ message: 'Failed to send message' });
  }
};

/**
 * Mark messages in conversation as read
 */
const markAsRead = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { userId: otherUserId } = req.params;

    const conversationId = getConversationId(currentUserId, otherUserId);
    const now = new Date();

    await Message.updateMany(
      { conversationId, recipient: currentUserId, isRead: false },
      { $set: { isRead: true, readAt: now } }
    );

    emitToUser(otherUserId, 'messages_read', {
      conversationId,
      readerId: currentUserId,
      readAt: now,
    });

    cache.del(`chat:unread:${currentUserId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('markAsRead error:', err);
    res.status(500).json({ message: 'Failed to mark messages as read' });
  }
};

/**
 * Get contacts reachable by the current user based on role
 */
const getContacts = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const role = req.user.role;
    let query = { _id: { $ne: currentUserId }, isActive: true };

    if (role === 'member') {
      // Member can contact gym admins, trainers, and specifically their assigned trainer
      query.role = { $in: ['admin', 'trainer'] };
    } else if (role === 'trainer') {
      // Trainer can contact admins, other trainers, and gym members
      query.role = { $in: ['admin', 'trainer', 'member'] };
    } else if (role === 'admin') {
      // Admin can contact anyone
    }

    const contacts = await User.find(query)
      .select('name email role avatar specialization phone')
      .sort({ role: 1, name: 1 })
      .lean();

    const onlineIds = new Set(getOnlineUserIds());
    const contactsWithStatus = contacts.map(c => ({
      ...c,
      isOnline: onlineIds.has(String(c._id)),
    }));

    res.json(contactsWithStatus);
  } catch (err) {
    console.error('getContacts error:', err);
    res.status(500).json({ message: 'Error loading contacts' });
  }
};

/**
 * Get total unread messages count for current user
 */
const getUnreadCount = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const count = await Message.countDocuments({
      recipient: currentUserId,
      isRead: false,
    });
    res.json({ unreadCount: count });
  } catch (err) {
    console.error('getUnreadCount error:', err);
    res.status(500).json({ message: 'Error getting unread count' });
  }
};

module.exports = {
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
  getContacts,
  getUnreadCount,
};
