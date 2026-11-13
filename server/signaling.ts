import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const MAX_ROOM_SIZE = 2;
const MAX_PAYLOAD_BYTES = 65_536;
const SALT_ROTATION_MS = 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 25_000;

const CREATE_WINDOW_MS = 60_000;
const CREATE_MAX_PER_WINDOW = 10;
const JOIN_WINDOW_MS = 60_000;
const JOIN_MAX_PER_WINDOW = 20;

interface PeerClient {
  peerId: string;
  socket: WebSocket;
  roomId: string | null;
  alive: boolean;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

interface ClientMessage {
  type: 'join' | 'signal' | 'leave' | 'ping';
  roomId?: string;
  action?: 'create' | 'join';
  payload?: string;
}

const ROOM_ID_PATTERN = /^[a-f0-9]{64}$/;

export function attachSignalingServer(httpServer: HttpServer, path = '/ws') {
  const wss = new WebSocketServer({
    server: httpServer,
    path,
    maxPayload: MAX_PAYLOAD_BYTES,
    perMessageDeflate: false,
  });

  // In-memory ephemeral room registry: roomId (SHA-256 hex) -> Map<peerId, PeerClient>
  const rooms = new Map<string, Map<string, PeerClient>>();

  // Hourly-rotating salt for in-memory IP rate-limit hashes (never persisted, never logged)
  let hourlySalt = randomBytes(32);
  let createLimits = new Map<string, RateBucket>();
  let joinLimits = new Map<string, RateBucket>();

  const saltTimer = setInterval(() => {
    hourlySalt = randomBytes(32);
    createLimits = new Map<string, RateBucket>();
    joinLimits = new Map<string, RateBucket>();
  }, SALT_ROTATION_MS);
  saltTimer.unref();

  function hashRemoteAddress(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    const rawIp =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim() ?? ''
        : Array.isArray(forwarded)
          ? forwarded[0] ?? ''
          : req.socket.remoteAddress ?? '';

    return createHmac('sha256', hourlySalt).update(rawIp).digest('hex');
  }

  function consumeRateLimit(
    buckets: Map<string, RateBucket>,
    key: string,
    maxCount: number,
    windowMs: number
  ): boolean {
    const now = Date.now();
    const existing = buckets.get(key);
    if (!existing || now >= existing.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (existing.count >= maxCount) {
      return false;
    }
    existing.count += 1;
    return true;
  }

  function sendJson(socket: WebSocket, message: Record<string, unknown>) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function removePeerFromRoom(peer: PeerClient) {
    const { roomId, peerId } = peer;
    if (!roomId) return;

    const room = rooms.get(roomId);
    peer.roomId = null;
    if (!room) return;

    room.delete(peerId);

    for (const other of room.values()) {
      sendJson(other.socket, {
        type: 'peer-left',
        peerId,
      });
    }

    if (room.size === 0) {
      rooms.delete(roomId);
    }
  }

  const heartbeatTimer = setInterval(() => {
    for (const client of wss.clients) {
      const peer = (client as WebSocket & { _speer?: PeerClient })._speer;
      if (!peer) continue;
      if (!peer.alive) {
        removePeerFromRoom(peer);
        client.terminate();
        continue;
      }
      peer.alive = false;
      client.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  wss.on('connection', (socket, req) => {
    const ipHash = hashRemoteAddress(req);
    const peer: PeerClient = {
      peerId: randomUUID(),
      socket,
      roomId: null,
      alive: true,
    };
    (socket as WebSocket & { _speer?: PeerClient })._speer = peer;

    socket.on('pong', () => {
      peer.alive = true;
    });

    socket.on('message', (rawData, isBinary) => {
      if (isBinary) {
        sendJson(socket, { type: 'error', code: 'INVALID_MESSAGE' });
        return;
      }

      let msg: ClientMessage;
      try {
        msg = JSON.parse(rawData.toString('utf8')) as ClientMessage;
      } catch {
        sendJson(socket, { type: 'error', code: 'INVALID_MESSAGE' });
        return;
      }

      if (!msg || typeof msg.type !== 'string') {
        sendJson(socket, { type: 'error', code: 'INVALID_MESSAGE' });
        return;
      }

      if (msg.type === 'ping') {
        sendJson(socket, { type: 'pong' });
        return;
      }

      if (msg.type === 'leave') {
        removePeerFromRoom(peer);
        return;
      }

      if (msg.type === 'join') {
        const roomId = msg.roomId;
        if (typeof roomId !== 'string' || !ROOM_ID_PATTERN.test(roomId)) {
          sendJson(socket, { type: 'error', code: 'INVALID_ROOM' });
          return;
        }

        const isCreate = msg.action === 'create';
        const allowed = isCreate
          ? consumeRateLimit(createLimits, ipHash, CREATE_MAX_PER_WINDOW, CREATE_WINDOW_MS)
          : consumeRateLimit(joinLimits, ipHash, JOIN_MAX_PER_WINDOW, JOIN_WINDOW_MS);

        if (!allowed) {
          sendJson(socket, { type: 'error', code: 'RATE_LIMITED' });
          return;
        }

        if (peer.roomId && peer.roomId !== roomId) {
          removePeerFromRoom(peer);
        }

        let room = rooms.get(roomId);
        if (!room) {
          room = new Map<string, PeerClient>();
          rooms.set(roomId, room);
        }

        if (!room.has(peer.peerId) && room.size >= MAX_ROOM_SIZE) {
          sendJson(socket, { type: 'error', code: 'ROOM_FULL' });
          socket.close(4003, 'ROOM_FULL');
          return;
        }

        const existingPeers = Array.from(room.keys()).filter((id) => id !== peer.peerId);
        room.set(peer.peerId, peer);
        peer.roomId = roomId;

        sendJson(socket, {
          type: 'joined',
          peerId: peer.peerId,
          peers: existingPeers,
        });

        for (const [otherId, otherPeer] of room.entries()) {
          if (otherId !== peer.peerId) {
            sendJson(otherPeer.socket, {
              type: 'peer-joined',
              peerId: peer.peerId,
            });
          }
        }
        return;
      }

      if (msg.type === 'signal') {
        if (!peer.roomId) {
          sendJson(socket, { type: 'error', code: 'NOT_IN_ROOM' });
          return;
        }
        if (typeof msg.payload !== 'string' || msg.payload.length === 0 || msg.payload.length > MAX_PAYLOAD_BYTES) {
          sendJson(socket, { type: 'error', code: 'INVALID_PAYLOAD' });
          return;
        }

        const room = rooms.get(peer.roomId);
        if (!room) return;

        for (const [otherId, otherPeer] of room.entries()) {
          if (otherId !== peer.peerId) {
            sendJson(otherPeer.socket, {
              type: 'signal',
              fromPeerId: peer.peerId,
              payload: msg.payload,
            });
          }
        }
      }
    });

    socket.on('close', () => {
      removePeerFromRoom(peer);
    });

    socket.on('error', () => {
      removePeerFromRoom(peer);
    });
  });

  wss.on('close', () => {
    clearInterval(saltTimer);
    clearInterval(heartbeatTimer);
    rooms.clear();
  });

  return wss;
}
