import { Server } from 'socket.io';

let socketServer: Server | null = null;

export function setSocketServer(server: Server) {
  socketServer = server;
}

export function getSocketServer(): Server {
  if (!socketServer) throw new Error('Socket server has not been initialized');
  return socketServer;
}
