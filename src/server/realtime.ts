import { WebSocketServer, WebSocket } from "ws";
import type { BroadcastEvent } from "./types";

const HEARTBEAT_INTERVAL_MS = 25_000;

type GlobalWithRealtime = typeof globalThis & {
  __demoWss?: WebSocketServer;
  __demoHeartbeat?: NodeJS.Timer;
};

const globalRealtime = globalThis as GlobalWithRealtime;

function ensureWebSocketServer(): WebSocketServer {
  if (!globalRealtime.__demoWss) {
    const port = Number(process.env.DEMO_WS_PORT ?? process.env.NEXT_PUBLIC_WS_PORT ?? "3333");
    const server = new WebSocketServer({ port });
    server.on("connection", (socket) => onConnection(socket as WebSocket));
    server.on("error", (error) => {
      console.error("[realtime] server error", error);
    });
    globalRealtime.__demoWss = server;
    if (!globalRealtime.__demoHeartbeat) {
      globalRealtime.__demoHeartbeat = setInterval(() => {
        server.clients.forEach((client) => {
          const wsClient = client as WebSocket & { isAlive?: boolean };
          if (wsClient.isAlive === false) {
            wsClient.terminate();
            return;
          }
          wsClient.isAlive = false;
          try {
            wsClient.ping();
          } catch (error) {
            console.error("[realtime] heartbeat ping failed", error);
          }
        });
      }, HEARTBEAT_INTERVAL_MS);
    }
    console.info("[realtime] WebSocket server listening on ws://localhost:" + port);
  }
  return globalRealtime.__demoWss!;
}

function onConnection(socket: WebSocket & { isAlive?: boolean }) {
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });
  socket.on("message", (raw) => {
    if (String(raw).trim() === "ping") {
      socket.send("pong");
    }
  });
}

export function getWebSocketServer(): WebSocketServer {
  return ensureWebSocketServer();
}

export function broadcast(event: BroadcastEvent) {
  const server = ensureWebSocketServer();
  const payload = JSON.stringify(event);
  server.clients.forEach((client) => {
    const wsClient = client as WebSocket;
    if (wsClient.readyState === WebSocket.OPEN) {
      wsClient.send(payload);
    }
  });
}
