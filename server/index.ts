import http from 'node:http';
import { attachSignalingServer } from './signaling.ts';

const port = Number(process.env.PORT ?? 3001);

const server = http.createServer((_req, res) => {
  res.writeHead(404);
  res.end();
});

attachSignalingServer(server, '/ws');

server.listen(port, '0.0.0.0');
