import dotenv from 'dotenv';
import path from 'path';

// Load root .env first (monorepo), then local overrides
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

import { createServer } from 'http';
import { Server } from 'socket.io';
import app from './app';
import { expireTransfers } from './lib/transferExpiry';
import { isFrontendOriginAllowed } from './lib/frontendOrigin';
import { verifyAccessToken } from './lib/jwt';
import prisma from './lib/prisma';
import { setSocketServer } from './lib/socket';

const PORT = process.env.PORT || 4000;
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isFrontendOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

io.use(async (socket, next) => {
  try {
    const authToken = typeof socket.handshake.auth.token === 'string' ? socket.handshake.auth.token : '';
    const authHeader = socket.handshake.headers.authorization;
    const token = authToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '');
    if (!token) return next(new Error('Authentication required'));
    const payload = verifyAccessToken(token);
    const [user, assignment] = await Promise.all([
      prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true, isActive: true } }),
      prisma.userRoleAssignment.findFirst({ where: { userId: payload.userId, role: payload.role, active: true }, select: { jurisdiction: true } }),
    ]);
    if (!user?.isActive || !assignment) return next(new Error('Invalid or inactive session role'));
    socket.data.userId = user.id;
    socket.data.role = payload.role;
    socket.data.jurisdiction = assignment.jurisdiction;
    next();
  } catch {
    next(new Error('Invalid socket session'));
  }
});
setSocketServer(io);

io.on('connection', (socket) => {
  socket.join(`user:${socket.data.userId}`);
  socket.join(`role:${socket.data.role}`);
  if (socket.data.role === 'GOVERNMENT' && socket.data.jurisdiction) {
    socket.join(`jurisdiction:${String(socket.data.jurisdiction).toLowerCase()}`);
  }
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const expiryTimer = process.env.NODE_ENV === 'test' ? null : setInterval(() => { expireTransfers().catch((err) => console.error('[transfer-expiry]', err)); }, 60_000);
expiryTimer?.unref();

httpServer.listen(PORT, () => {
  console.log(`BlockLand API running on port ${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/api/v1/docs`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  httpServer.close(() => {
    console.log('HTTP server closed');
  });
});
