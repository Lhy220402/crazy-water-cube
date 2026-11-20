#!/usr/bin/env node
/**
 * 本地预览：node scripts/dev.mjs [端口]
 * 同时启动构建监听和静态服务器，手机与电脑在同一网络下可直接访问。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const watcher = spawn(process.execPath, [resolve(root, 'scripts/build.mjs'), '--watch'], {
  stdio: 'inherit',
});

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname === '/' ? '/dist/2048.html' : url.pathname;
    const file = resolve(root, `.${path}`);
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
});

server.listen(port, () => {
  const nets = Object.values(networkInterfaces()).flat();
  const lan = nets.find((net) => net && net.family === 'IPv4' && !net.internal)?.address;
  console.log(`\n  本机预览：http://localhost:${port}/`);
  if (lan) console.log(`  手机访问：http://${lan}:${port}/`);
  console.log('  Ctrl+C 结束\n');
});

const shutdown = () => {
  watcher.kill('SIGTERM');
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
