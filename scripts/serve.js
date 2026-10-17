import http from 'node:http';
import { createReadStream } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let port = 4173;
let useDist = false;
try {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--dist') useDist = true;
    else if (args[index] === '--port') {
      const value = args[++index];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
        throw new Error('--port must be an integer from 1 to 65535.');
      }
      port = Number(value);
    } else throw new Error(`Unknown option: ${args[index]}`);
  }
} catch (error) {
  console.error(`backoff-lab server: ${error.message}`);
  process.exit(1);
}

let root;
try {
  if (useDist && !(await lstat(path.join(projectRoot, 'dist'))).isDirectory()) {
    throw new Error('Invalid dist directory');
  }
  root = await realpath(useDist ? path.join(projectRoot, 'dist') : projectRoot);
} catch {
  console.error('backoff-lab server: dist/ is missing or is not a regular directory. Run npm run build first.');
  process.exit(1);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const fail = (code, message) => {
    response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`${message}\n`);
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    fail(405, 'Method not allowed');
    return;
  }
  try {
    const pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const segments = pathname.split('/');
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || segments.some((part) => part.startsWith('.'))) {
      fail(403, 'Forbidden');
      return;
    }
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    // Development only serves the same public inputs that the static build uses.
    const firstSegment = relativePath.split('/')[0];
    // Apply the same allowlist to previews, even if unrelated files exist in dist/.
    if (!['index.html', 'styles.css', 'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'LICENSE', 'src', 'assets', 'docs', 'examples'].includes(firstSegment)) {
      fail(404, 'Not found');
      return;
    }
    const candidate = path.resolve(root, relativePath);
    // A link inside an allowed directory must not expose private project files.
    let component = root;
    for (const part of relativePath.split('/')) {
      component = path.join(component, part);
      if ((await lstat(component)).isSymbolicLink()) {
        fail(403, 'Forbidden');
        return;
      }
    }
    const resolved = await realpath(candidate);
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      fail(403, 'Forbidden');
      return;
    }
    const info = await stat(resolved);
    if (!info.isFile()) {
      fail(404, 'Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': path.basename(resolved) === 'LICENSE' ? 'text/plain; charset=utf-8' : (mimeTypes[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream'),
      'Content-Length': info.size,
    });
    if (request.method === 'HEAD') response.end();
    else await pipeline(createReadStream(resolved), response);
  } catch (error) {
    if (response.headersSent) response.destroy();
    else fail(error instanceof URIError ? 400 : 404, error instanceof URIError ? 'Malformed URL' : 'Not found');
  }
});

server.on('error', (error) => {
  console.error(`backoff-lab server: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Backoff Lab: http://127.0.0.1:${port}${useDist ? ' (dist)' : ''}`);
});
