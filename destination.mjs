import http from 'node:http';
import { openDestination } from './lib/store.mjs';
import { collectionPage } from './lib/view.mjs';
import { resolve } from 'node:path';
const [dir, port] = process.argv.slice(2);
const store = openDestination(resolve(dir || '.restore-drill'));
const server = http.createServer((req, res) => {
  try {
    if (!['127.0.0.1', 'localhost'].includes((req.headers.host || '').split(':')[0]))
      throw Object.assign(Error('Local host required'), { status: 403 });
    const url = new URL(req.url, 'http://localhost'),
      match = /^\/copies\/([a-f0-9-]+)$/.exec(url.pathname);
    if (req.method !== 'GET' || !match)
      throw Object.assign(Error('Read-only destination. Copy not found.'), { status: 404 });
    const copy = store.copy(match[1]);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
    });
    res.end(collectionPage(copy.name, copy.archive, 'Restored library', url.searchParams));
  } catch (e) {
    res.writeHead(e.status || 400, { 'content-type': 'text/plain' });
    res.end(e.message);
  }
});
server.on('error', (e) => {
  console.error(e.message);
  process.exit(1);
});
server.listen(Number(port ?? 4318), '127.0.0.1', () => {
  const address = 'http://127.0.0.1:' + server.address().port;
  if (process.send) process.send({ address });
  else console.log(address);
});
process.on('disconnect', () =>
  server.close(() => {
    store.close();
    process.exit(0);
  })
);
