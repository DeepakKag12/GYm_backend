const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User.model');
const { Message, getConversationId } = require('./models/Message.model');
const cache = require('./utils/cache');

let io = null;

// Track online users: Map<userIdString, Set<socketIdString>>
const activeSocketsByUser = new Map();

/**
 * Check if origin is allowed for WebSocket connections
 */
const KNOWN_FRONTEND_ORIGINS = [
  'https://gym-web-ten-puce.vercel.app',
  'https://gym-web.vercel.app',
];

const allowedOrigins = [...new Set([
  ...KNOWN_FRONTEND_ORIGINS,
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ...(process.env.ALLOWED_ORIGINS || '').split(','),
].map(s => s.trim().replace(/\/+$/, '')).filter(Boolean))];

const isLocalOrigin = origin => /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|[a-z0-9-]+\.local)(?::\d+)?$/i.test(origin);
const VERCEL_FRONTEND_PATTERN = /^https:\/\/(?:[a-z0-9-]+\.)*(?:gym(?:-[a-z0-9-]+)*|fitnation|fitnessbyajeet)(?:-[a-z0-9-]+)?(?:\.vercel\.app|-deepak-kags-projects\.vercel\.app)$/i;

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (process.env.NODE_ENV !== 'production') return true;
  if (allowedOrigins.includes(origin)) return true;
  if (allowedOrigins.length === 0) return true;
  if (/\.vercel\.app$/i.test(origin)) return true;
  if (VERCEL_FRONTEND_PATTERN.test(origin)) return true;
  if (isLocalOrigin(origin)) return true;
  return false;
}

/**
 * Initialize Socket.IO with HTTP Server
 */
function initSocket(server) {
  if (io) return io;

  io = new Server(server, {
    cors: {
      origin: function (origin, callback) {
        if (isOriginAllowed(origin)) return callback(null, true);
        console.warn(`[Socket CORS] blocked origin: ${origin}`);
        return callback(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 30000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
  });

  // Attach Redis adapter for horizontal multi-instance scaling if Redis is configured
  try {
    const { getRedisClient, isRedisReady } = require('./config/redis');
    if (isRedisReady()) {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const pubClient = getRedisClient();
      const subClient = pubClient.duplicate();
      subClient.on('error', () => {});
      io.adapter(createAdapter(pubClient, subClient));
      console.log('⚡ [Socket.IO] Redis adapter attached for multi-server scaling.');
    }
  } catch (err) {
    console.warn('⚠️ [Socket.IO] Could not attach Redis adapter, using in-memory adapter:', err.message);
  }

  // Socket Authentication Middleware
  io.use(async (socket, next) => {
    try {
      let token = socket.handshake.auth?.token;
      if (!token && socket.handshake.headers?.authorization) {
        const parts = socket.handshake.headers.authorization.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') token = parts[1];
      }
      if (!token && socket.handshake.query?.token) {
        token = socket.handshake.query.token;
      }

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const targetUserId = decoded.id || decoded._id || decoded.userId;
      const cacheKey = `user:${targetUserId}`;
      let user = cache.get(cacheKey);

      if (!user) {
        user = await cache.getOrSet(cacheKey, 300, async () => {
          return User.findById(targetUserId).select('-password').lean();
        });
      }

      if (!user || user.isActive === false) {
        return next(new Error('User not found or deactivated'));
      }

      socket.user = user;
      return next();
    } catch (err) {
      return next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = String(socket.user._id);
    const role = socket.user.role;

    // Join user-specific private room
    socket.join(`user:${userId}`);
    // Join role-specific broadcast room
    socket.join(`role:${role}`);
    socket.join('authenticated');

    // Register active socket for user
    if (!activeSocketsByUser.has(userId)) {
      activeSocketsByUser.set(userId, new Set());
    }
    activeSocketsByUser.get(userId).add(socket.id);

    // Broadcast user online event if this is their first connection
    if (activeSocketsByUser.get(userId).size === 1) {
      io.emit('user_online', { userId, role, name: socket.user.name });
    }

    // Send current list of online users to the connecting client
    socket.emit('online_users', Array.from(activeSocketsByUser.keys()));

    // ── Real-time Chat Events ──

    // Explicitly query online users on demand
    socket.on('get_online_users', (ack) => {
      const online = Array.from(activeSocketsByUser.keys());
      if (typeof ack === 'function') ack(online);
      else socket.emit('online_users', online);
    });

    // Join specific conversation room
    socket.on('join_conversation', ({ recipientId }) => {
      if (!recipientId) return;
      const conversationId = getConversationId(userId, recipientId);
      socket.join(`conversation:${conversationId}`);
    });

    // Leave conversation room
    socket.on('leave_conversation', ({ recipientId }) => {
      if (!recipientId) return;
      const conversationId = getConversationId(userId, recipientId);
      socket.leave(`conversation:${conversationId}`);
    });

    // Send Message Event
    socket.on('send_message', async ({ recipientId, text, attachments = [] }, ack) => {
      try {
        if (!recipientId || !text || !text.trim()) {
          if (typeof ack === 'function') ack({ success: false, error: 'Recipient and message text are required.' });
          return;
        }

        const trimmedText = text.trim();
        const conversationId = getConversationId(userId, recipientId);

        // Verify recipient exists
        const recipient = await User.findById(recipientId).select('name email role avatar').lean();
        if (!recipient) {
          if (typeof ack === 'function') ack({ success: false, error: 'Recipient not found.' });
          return;
        }

        const messageDoc = await Message.create({
          conversationId,
          sender: userId,
          recipient: recipientId,
          text: trimmedText,
          attachments,
        });

        const populatedMessage = await Message.findById(messageDoc._id)
          .populate('sender', 'name email role avatar')
          .populate('recipient', 'name email role avatar')
          .lean();

        // Emit new_message to both participants' rooms
        io.to(`user:${userId}`).emit('new_message', populatedMessage);
        io.to(`user:${recipientId}`).emit('new_message', populatedMessage);

        // Emit conversation update notification for instantaneous conversation list refreshes
        const conversationUpdate = {
          conversationId,
          lastMessage: populatedMessage,
          senderId: userId,
          recipientId,
        };
        io.to(`user:${userId}`).emit('conversation_updated', conversationUpdate);
        io.to(`user:${recipientId}`).emit('conversation_updated', conversationUpdate);

        // Invalidate message cache
        cache.del(`chat:unread:${recipientId}`);

        if (typeof ack === 'function') ack({ success: true, message: populatedMessage });
      } catch (err) {
        console.error('[Socket send_message error]:', err);
        if (typeof ack === 'function') ack({ success: false, error: 'Failed to send message.' });
      }
    });

    // Typing Indicators
    socket.on('typing', ({ recipientId }) => {
      if (!recipientId) return;
      io.to(`user:${recipientId}`).emit('user_typing', {
        userId,
        name: socket.user.name,
        isTyping: true,
      });
    });

    socket.on('stop_typing', ({ recipientId }) => {
      if (!recipientId) return;
      io.to(`user:${recipientId}`).emit('user_typing', {
        userId,
        name: socket.user.name,
        isTyping: false,
      });
    });

    // Mark Messages as Read
    socket.on('mark_read', async ({ senderId }, ack) => {
      try {
        if (!senderId) return;
        const conversationId = getConversationId(userId, senderId);
        const now = new Date();

        await Message.updateMany(
          { conversationId, recipient: userId, isRead: false },
          { $set: { isRead: true, readAt: now } }
        );

        // Notify original sender that their messages have been read
        io.to(`user:${senderId}`).emit('messages_read', {
          conversationId,
          readerId: userId,
          readAt: now,
        });

        cache.del(`chat:unread:${userId}`);
        if (typeof ack === 'function') ack({ success: true });
      } catch (err) {
        console.error('[Socket mark_read error]:', err);
        if (typeof ack === 'function') ack({ success: false, error: err.message });
      }
    });

    // Admin Gym Announcement Broadcast Event
    socket.on('broadcast_announcement', ({ targetRole, title, message }, ack) => {
      try {
        if (socket.user.role !== 'admin') {
          if (typeof ack === 'function') ack({ success: false, error: 'Admin only.' });
          return;
        }
        const announcementData = {
          title: title || 'Gym Announcement',
          message,
          senderName: socket.user.name,
          createdAt: new Date(),
        };
        if (targetRole) {
          io.to(`role:${targetRole}`).emit('gym_announcement', announcementData);
        } else {
          io.to('authenticated').emit('gym_announcement', announcementData);
        }
        if (typeof ack === 'function') ack({ success: true });
      } catch (err) {
        if (typeof ack === 'function') ack({ success: false, error: err.message });
      }
    });

    // Disconnect Handler
    socket.on('disconnect', () => {
      const userSockets = activeSocketsByUser.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          activeSocketsByUser.delete(userId);
          // Broadcast offline status
          io.emit('user_offline', { userId, role, name: socket.user.name });
        }
      }
    });
  });

  return io;
}

/**
 * Access the active Socket.IO server instance
 */
function getIO() {
  return io;
}

/**
 * Safely emit an event to a specific user by their ID
 */
function emitToUser(userId, event, data) {
  if (!io) return false;
  io.to(`user:${String(userId)}`).emit(event, data);
  return true;
}

/**
 * Safely emit an event to all members of a role ('admin', 'trainer', 'member')
 */
function emitToRole(role, event, data) {
  if (!io) return false;
  io.to(`role:${role}`).emit(event, data);
  return true;
}

/**
 * Broadcast an event to all authenticated connected clients
 */
function broadcastEvent(event, data) {
  if (!io) return false;
  io.to('authenticated').emit(event, data);
  return true;
}

/**
 * Check if a user is currently connected to WebSockets
 */
function isUserOnline(userId) {
  return activeSocketsByUser.has(String(userId));
}

/**
 * Get array of all currently connected user IDs
 */
function getOnlineUserIds() {
  return Array.from(activeSocketsByUser.keys());
}

module.exports = {
  initSocket,
  getIO,
  emitToUser,
  emitToRole,
  broadcastEvent,
  isUserOnline,
  getOnlineUserIds,
};
