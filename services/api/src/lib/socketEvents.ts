import { Server } from 'socket.io';
import prisma from './prisma';

function emitOfficerScoped(io: Server, state: string, event: string, payload: object) {
  io.to(`jurisdiction:${state.toLowerCase()}`).emit(event, payload);
  io.to('jurisdiction:*').emit(event, payload);
  io.to('role:ADMIN').emit(event, payload);
}

export const emitVerificationUpdate = (io: Server, requestId: string, status: string) => {
  void prisma.verificationRequest.findUnique({
    where: { id: requestId },
    select: { requestedById: true, land: { select: { state: true, ownerId: true } } },
  }).then((request) => {
    if (!request) return;
    const payload = { requestId, status };
    if (request.requestedById) io.to(`user:${request.requestedById}`).emit('verification:updated', payload);
    if (request.land.ownerId) io.to(`user:${request.land.ownerId}`).emit('verification:updated', payload);
    emitOfficerScoped(io, request.land.state, 'verification:updated', payload);
  }).catch((err) => console.error('[socket:verification-update]', err));
};

export const emitTransferUpdate = (io: Server, transferId: string, status: string) => {
  void prisma.transfer.findUnique({
    where: { id: transferId },
    select: { fromUserId: true, toUserId: true, land: { select: { state: true } } },
  }).then((transfer) => {
    if (!transfer) return;
    const payload = { transferId, status };
    io.to(`user:${transfer.fromUserId}`).emit('transfer:updated', payload);
    if (transfer.toUserId) io.to(`user:${transfer.toUserId}`).emit('transfer:updated', payload);
    emitOfficerScoped(io, transfer.land.state, 'transfer:updated', payload);
  }).catch((err) => console.error('[socket:transfer-update]', err));
};

export const emitNewRegistration = (io: Server, plotId: string) => {
  void prisma.land.findUnique({
    where: { plotId },
    select: { state: true, ownerId: true },
  }).then((land) => {
    if (!land) return;
    const payload = { plotId };
    if (land.ownerId) io.to(`user:${land.ownerId}`).emit('land:registered', payload);
    emitOfficerScoped(io, land.state, 'land:registered', payload);
  }).catch((err) => console.error('[socket:land-registration]', err));
};
