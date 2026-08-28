import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const siteRoot = resolve(dirname(scriptPath), '..');

const contentTypes = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

function fileForRequest(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const candidate = resolve(siteRoot, decodedPath.replace(/^\/+/, ''));
  if (candidate !== siteRoot && !candidate.startsWith(siteRoot + sep)) return null;

  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    const indexFile = join(candidate, 'index.html');
    if (existsSync(indexFile)) return indexFile;
  }

  return null;
}

function sendFile(request, response, file, statusCode) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypes.get(extname(file).toLowerCase()) || 'application/octet-stream',
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(file).pipe(response);
}

export function createSiteServer() {
  return createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method Not Allowed');
      return;
    }

    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    const file = fileForRequest(requestUrl.pathname);
    if (file) {
      sendFile(request, response, file, 200);
      return;
    }

    sendFile(request, response, join(siteRoot, '404.html'), 404);
  });
}

export function startSiteServer({
  host = process.env.HOST || '127.0.0.1',
  port = Number(process.env.PORT || 4173),
} = {}) {
  const server = createSiteServer();
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, host, () => {
      server.removeListener('error', rejectPromise);
      resolvePromise(server);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const server = await startSiteServer();
  const address = server.address();
  console.log(`Serving ${siteRoot} at http://${address.address}:${address.port}`);

  const close = () => server.close(() => process.exit(0));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
