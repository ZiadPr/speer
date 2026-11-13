import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachSignalingServer } from './server/signaling.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === 'production';

interface RegionalStunConfig {
  region: string;
  urls: string | string[];
}

function parseJsonEnv<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Security headers with zero tracking or logging
  app.use((_req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self)');
    next();
  });

  app.get('/api/ping', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(204).end();
  });

  app.get('/api/ice-config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    const defaultRegions: RegionalStunConfig[] = [
      { region: 'us', urls: 'stun:stun.l.google.com:19302' },
      { region: 'eu', urls: 'stun:stun1.l.google.com:19302' },
      { region: 'ap', urls: 'stun:stun2.l.google.com:19302' },
      { region: 'sa', urls: 'stun:stun3.l.google.com:19302' },
    ];

    const stunRegions = parseJsonEnv<RegionalStunConfig[]>(
      process.env.VITE_STUN_REGIONS,
      defaultRegions
    );

    const turnServers = parseJsonEnv<RTCIceServer[]>(process.env.TURN_SERVERS, []);

    const fallbackStunUrls = (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    res.json({
      stunRegions,
      turnServers,
      fallbackStunUrls,
    });
  });

  // Serve MediaPipe WASM files from same-origin for reliable offline/CSP-safe background blur
  const mediapipeWasmDir = path.resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm');
  app.use('/mediapipe-wasm', express.static(mediapipeWasmDir, { maxAge: '1d' }));

  const httpServer = http.createServer(app);
  attachSignalingServer(httpServer, '/ws');

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0');
}

startServer().catch(() => {
  process.exit(1);
});
