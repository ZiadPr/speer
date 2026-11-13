interface CfWebSocket extends WebSocket {
  accept(): void;
  serializeAttachment?(attachment: unknown): void;
  deserializeAttachment?(): unknown;
}

interface CfWebSocketPair {
  0: CfWebSocket;
  1: CfWebSocket;
}

interface CfDurableObjectId {
  toString(): string;
}

interface CfDurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface CfDurableObjectNamespace {
  idFromName(name: string): CfDurableObjectId;
  get(id: CfDurableObjectId): CfDurableObjectStub;
}

interface CfDurableObjectState {
  getWebSockets?(tag?: string): CfWebSocket[];
  acceptWebSocket?(ws: CfWebSocket, tags?: string[]): void;
}

interface CfAssetsFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: CfAssetsFetcher;
  ROOMS: CfDurableObjectNamespace;
  RATE_LIMITER: CfDurableObjectNamespace;
  VITE_STUN_REGIONS?: string;
  TURN_SERVERS?: string;
  STUN_URLS?: string;
}

const MAX_ROOM_SIZE = 2;
const MAX_PAYLOAD_BYTES = 65_536;
const SALT_ROTATION_MS = 60 * 60 * 1000;
const CREATE_WINDOW_MS = 60_000;
const CREATE_MAX_PER_WINDOW = 10;
const JOIN_WINDOW_MS = 60_000;
const JOIN_MAX_PER_WINDOW = 20;
const ROOM_ID_PATTERN = /^[a-f0-9]{64}$/;

interface ClientMessage {
  type: 'join' | 'signal' | 'leave' | 'ping';
  roomId?: string;
  action?: 'create' | 'join';
  payload?: string;
}

function securityHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self)',
    ...extra,
  };
}

function parseJsonEnv<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function hmacSha256Hex(keyBytes: Uint8Array, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function createWebSocketResponse(clientSocket: CfWebSocket): Response {
  return new Response(null, {
    status: 101,
    webSocket: clientSocket,
  } as unknown as ResponseInit);
}

/**
 * Ephemeral in-memory rate limiter using hourly-rotating salted IP hashes.
 * Never logs or persists IP addresses.
 */
export class RateLimitDurableObject {
  private salt: Uint8Array = crypto.getRandomValues(new Uint8Array(32));
  private saltCreatedAt = Date.now();
  private createBuckets = new Map<string, { count: number; resetAt: number }>();
  private joinBuckets = new Map<string, { count: number; resetAt: number }>();

  constructor(_state: CfDurableObjectState) {}

  private rotateIfNeeded() {
    const now = Date.now();
    if (now - this.saltCreatedAt >= SALT_ROTATION_MS) {
      this.salt = crypto.getRandomValues(new Uint8Array(32));
      this.saltCreatedAt = now;
      this.createBuckets.clear();
      this.joinBuckets.clear();
    }
  }

  private consume(
    buckets: Map<string, { count: number; resetAt: number }>,
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

  async fetch(request: Request): Promise<Response> {
    this.rotateIfNeeded();
    const body = (await request.json().catch(() => null)) as {
      ip?: string;
      action?: 'create' | 'join';
    } | null;

    const ip = body?.ip ?? '';
    const action = body?.action === 'create' ? 'create' : 'join';
    const ipHash = await hmacSha256Hex(this.salt, ip);

    const allowed =
      action === 'create'
        ? this.consume(this.createBuckets, ipHash, CREATE_MAX_PER_WINDOW, CREATE_WINDOW_MS)
        : this.consume(this.joinBuckets, ipHash, JOIN_MAX_PER_WINDOW, JOIN_WINDOW_MS);

    return new Response(JSON.stringify({ allowed }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}

/**
 * Ephemeral 2-peer room Durable Object.
 * Keeps peers strictly in memory; zero storage writes, zero payload inspection.
 */
export class RoomDurableObject {
  private peers = new Map<string, CfWebSocket>();

  constructor(_state: CfDurableObjectState) {}

  private sendJson(ws: CfWebSocket, msg: Record<string, unknown>) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Ignore closed socket
    }
  }

  private removePeer(peerId: string) {
    const removed = this.peers.delete(peerId);
    if (!removed) return;

    for (const other of this.peers.values()) {
      this.sendJson(other, {
        type: 'peer-left',
        peerId,
      });
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pairCtor = (globalThis as unknown as { WebSocketPair: new () => CfWebSocketPair })
      .WebSocketPair;
    const pair = new pairCtor();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const peerId = crypto.randomUUID();
    const actionHeader = request.headers.get('x-speer-action') ?? 'join';
    const existingPeers = Array.from(this.peers.keys());

    if (this.peers.size >= MAX_ROOM_SIZE) {
      this.sendJson(server, { type: 'error', code: 'ROOM_FULL' });
      server.close(4003, 'ROOM_FULL');
      return createWebSocketResponse(client);
    }

    this.peers.set(peerId, server);
    this.sendJson(server, {
      type: 'joined',
      peerId,
      peers: existingPeers,
      action: actionHeader,
    });

    for (const [otherId, otherWs] of this.peers.entries()) {
      if (otherId !== peerId) {
        this.sendJson(otherWs, {
          type: 'peer-joined',
          peerId,
        });
      }
    }

    server.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') {
        this.sendJson(server, { type: 'error', code: 'INVALID_MESSAGE' });
        return;
      }

      let msg: ClientMessage;
      try {
        msg = JSON.parse(event.data) as ClientMessage;
      } catch {
        this.sendJson(server, { type: 'error', code: 'INVALID_MESSAGE' });
        return;
      }

      if (msg.type === 'ping') {
        this.sendJson(server, { type: 'pong' });
        return;
      }

      if (msg.type === 'leave') {
        this.removePeer(peerId);
        return;
      }

      if (msg.type === 'signal') {
        if (
          typeof msg.payload !== 'string' ||
          msg.payload.length === 0 ||
          msg.payload.length > MAX_PAYLOAD_BYTES
        ) {
          this.sendJson(server, { type: 'error', code: 'INVALID_PAYLOAD' });
          return;
        }

        for (const [otherId, otherWs] of this.peers.entries()) {
          if (otherId !== peerId) {
            this.sendJson(otherWs, {
              type: 'signal',
              fromPeerId: peerId,
              payload: msg.payload,
            });
          }
        }
      }
    });

    server.addEventListener('close', () => {
      this.removePeer(peerId);
    });

    server.addEventListener('error', () => {
      this.removePeer(peerId);
    });

    return createWebSocketResponse(client);
  }
}

/**
 * Edge gateway WebSocket that reads the client's first 'join' message,
 * verifies rate limits, and bridges directly to the room's Durable Object.
 */
async function handleWebSocketUpgrade(request: Request, env: Env): Promise<Response> {
  const pairCtor = (globalThis as unknown as { WebSocketPair: new () => CfWebSocketPair })
    .WebSocketPair;
  const pair = new pairCtor();
  const client = pair[0];
  const edgeSocket = pair[1];
  edgeSocket.accept();

  let roomSocket: WebSocket | null = null;
  const clientIp = request.headers.get('CF-Connecting-IP') ?? '';

  const sendEdgeJson = (msg: Record<string, unknown>) => {
    try {
      edgeSocket.send(JSON.stringify(msg));
    } catch {
      // ignore
    }
  };

  edgeSocket.addEventListener('message', async (event: MessageEvent) => {
    if (roomSocket) {
      try {
        roomSocket.send(event.data as string);
      } catch {
        // ignore
      }
      return;
    }

    if (typeof event.data !== 'string') {
      sendEdgeJson({ type: 'error', code: 'INVALID_MESSAGE' });
      return;
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(event.data) as ClientMessage;
    } catch {
      sendEdgeJson({ type: 'error', code: 'INVALID_MESSAGE' });
      return;
    }

    if (msg.type === 'ping') {
      sendEdgeJson({ type: 'pong' });
      return;
    }

    if (msg.type !== 'join') {
      sendEdgeJson({ type: 'error', code: 'NOT_IN_ROOM' });
      return;
    }

    const roomId = msg.roomId;
    if (typeof roomId !== 'string' || !ROOM_ID_PATTERN.test(roomId)) {
      sendEdgeJson({ type: 'error', code: 'INVALID_ROOM' });
      return;
    }

    const action = msg.action === 'create' ? 'create' : 'join';

    // Check rate limit via global in-memory RateLimitDurableObject
    const rlId = env.RATE_LIMITER.idFromName('global');
    const rlStub = env.RATE_LIMITER.get(rlId);
    const rlRes = await rlStub.fetch('https://rate-limiter/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: clientIp, action }),
    });
    const rlData = (await rlRes.json()) as { allowed?: boolean };
    if (!rlData.allowed) {
      sendEdgeJson({ type: 'error', code: 'RATE_LIMITED' });
      return;
    }

    const roomObjId = env.ROOMS.idFromName(roomId);
    const roomStub = env.ROOMS.get(roomObjId);
    const upgradeRes = await roomStub.fetch('https://room/ws', {
      headers: {
        Upgrade: 'websocket',
        'x-speer-action': action,
      },
    });

    const upstream = (upgradeRes as unknown as { webSocket?: CfWebSocket }).webSocket;
    if (!upstream) {
      sendEdgeJson({ type: 'error', code: 'UNKNOWN' });
      edgeSocket.close(1011);
      return;
    }

    upstream.accept();
    roomSocket = upstream;

    upstream.addEventListener('message', (upstreamEvent: MessageEvent) => {
      try {
        edgeSocket.send(upstreamEvent.data as string);
      } catch {
        // ignore
      }
    });

    upstream.addEventListener('close', (closeEvent: CloseEvent) => {
      try {
        edgeSocket.close(closeEvent.code, closeEvent.reason);
      } catch {
        // ignore
      }
    });
  });

  edgeSocket.addEventListener('close', () => {
    try {
      roomSocket?.close();
    } catch {
      // ignore
    }
  });

  return createWebSocketResponse(client);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426, headers: securityHeaders() });
      }
      return handleWebSocketUpgrade(request, env);
    }

    if (url.pathname === '/api/ping') {
      return new Response(null, {
        status: 204,
        headers: securityHeaders({ 'Cache-Control': 'no-store' }),
      });
    }

    if (url.pathname === '/api/ice-config') {
      const defaultRegions = [
        { region: 'us', urls: 'stun:stun.l.google.com:19302' },
        { region: 'eu', urls: 'stun:stun1.l.google.com:19302' },
        { region: 'ap', urls: 'stun:stun2.l.google.com:19302' },
        { region: 'sa', urls: 'stun:stun3.l.google.com:19302' },
      ];

      const stunRegions = parseJsonEnv(env.VITE_STUN_REGIONS, defaultRegions);
      const turnServers = parseJsonEnv(env.TURN_SERVERS, []);
      const fallbackStunUrls = (env.STUN_URLS ?? 'stun:stun.l.google.com:19302')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      return new Response(
        JSON.stringify({ stunRegions, turnServers, fallbackStunUrls }),
        {
          headers: securityHeaders({
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          }),
        }
      );
    }

    const assetRes = await env.ASSETS.fetch(request);
    const headers = new Headers(assetRes.headers);
    for (const [k, v] of Object.entries(securityHeaders())) {
      headers.set(k, v);
    }
    return new Response(assetRes.body, {
      status: assetRes.status,
      statusText: assetRes.statusText,
      headers,
    });
  },
};
