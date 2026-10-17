import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'backoff-lab-package-'));
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  await cp(path.join(root, 'scripts'), path.join(directory, 'scripts'), { recursive: true });
  const files = {
    'index.html': '<!doctype html><title>Backoff Lab</title>',
    'styles.css': 'body { color: black; }',
    'README.md': '# Backoff Lab',
    'README.zh-CN.md': '# 退避实验室',
    'CONTRIBUTING.md': '# Contributing',
    'CHANGELOG.md': '# Changelog',
    LICENSE: 'MIT License',
    'src/app.js': 'export const name = "Backoff Lab";',
    'assets/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'docs/model.md': '# Model',
    'examples/scenario.json': '{"clients":12}',
    'assets/.hidden': 'private asset',
    '.env': 'private configuration',
  };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await writeFile(path.join(directory, name), content);
  }
  return directory;
}

const build = (cwd) => spawnSync(process.execPath, ['scripts/build.js'], { cwd, encoding: 'utf8', timeout: 10_000 });

test('build includes public documentation and examples, replacing an older build', async () => {
  const directory = await fixture();
  try {
    await mkdir(path.join(directory, 'dist'));
    await writeFile(path.join(directory, 'dist', 'obsolete.txt'), 'old build');
    const result = build(directory);
    assert.equal(result.status, 0, result.stderr);
    for (const name of ['index.html', 'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'LICENSE', 'docs/model.md', 'examples/scenario.json', 'src/app.js']) {
      assert.equal(await readFile(path.join(directory, 'dist', name), 'utf8'), await readFile(path.join(directory, name), 'utf8'));
    }
    for (const name of ['obsolete.txt', 'package.json', 'scripts/build.js', '.env', 'assets/.hidden']) {
      await assert.rejects(readFile(path.join(directory, 'dist', name)), { code: 'ENOENT' });
    }
    assert.ok((await readdir(directory)).every((name) => !name.startsWith('.backoff-')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed builds preserve the last good build and refuse symbolic-link inputs', async () => {
  const directory = await fixture();
  try {
    assert.equal(build(directory).status, 0);
    const previous = await readFile(path.join(directory, 'dist', 'LICENSE'), 'utf8');
    await symlink(path.join(directory, '.env'), path.join(directory, 'assets', 'leak.txt'));
    const result = build(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not links/);
    assert.equal(await readFile(path.join(directory, 'dist', 'LICENSE'), 'utf8'), previous);
    await assert.rejects(readFile(path.join(directory, 'dist', 'assets', 'leak.txt')), { code: 'ENOENT' });
    assert.ok((await readdir(directory)).every((name) => !name.startsWith('.backoff-')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('build refuses unexpected input types without deleting the previous build', async () => {
  const directory = await fixture();
  try {
    assert.equal(build(directory).status, 0);
    await rm(path.join(directory, 'LICENSE'));
    await mkdir(path.join(directory, 'LICENSE'));
    const result = build(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unexpected build input: LICENSE/);
    assert.equal(await readFile(path.join(directory, 'dist', 'LICENSE'), 'utf8'), 'MIT License');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startServer(directory, useDist) {
  const port = await availablePort();
  const child = spawn(process.execPath, ['scripts/serve.js', '--port', String(port), ...(useDist ? ['--dist'] : [])], {
    cwd: directory,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = new Promise((resolve) => child.once('exit', resolve));
  let errors = '';
  child.stderr.on('data', (data) => { errors += data; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${errors}`)), 5000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`Server exited: ${errors}`)); });
      child.stdout.on('data', (data) => {
        if (data.toString().includes('Backoff Lab:')) { clearTimeout(timer); resolve(); }
      });
    });
  } catch (error) {
    child.kill();
    await closed;
    throw error;
  }
  return { port, close: async () => { child.kill(); await closed; } };
}

function request(port, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}

test('development and preview servers expose public files and reject private paths', async () => {
  const directory = await fixture();
  try {
    assert.equal(build(directory).status, 0);
    for (const useDist of [false, true]) {
      const publicRoot = useDist ? path.join(directory, 'dist') : directory;
      await writeFile(path.join(publicRoot, 'private.txt'), 'private');
      await symlink(path.join(directory, '.env'), path.join(publicRoot, 'assets', 'link.txt'));
      const server = await startServer(directory, useDist);
      try {
        for (const name of ['/', '/README.md', '/README.zh-CN.md', '/CONTRIBUTING.md', '/CHANGELOG.md', '/LICENSE', '/docs/model.md', '/examples/scenario.json', '/src/app.js']) {
          const result = await request(server.port, name);
          assert.equal(result.status, 200, name);
          assert.ok(Number(result.headers['content-length']) > 0);
          assert.equal(result.headers['x-content-type-options'], 'nosniff');
        }
        assert.match((await request(server.port, '/LICENSE')).headers['content-type'], /^text\/plain/);
        const head = await request(server.port, '/README.md', 'HEAD');
        assert.equal(head.status, 200);
        assert.equal(head.body, '');
        for (const [name, expected] of [['/.env', 403], ['/%2e%2e/.env', 403], ['/assets/link.txt', 403], ['/assets/.hidden', 403], ['/private.txt', 404], ['/package.json', 404], ['/scripts/serve.js', 404], ['/src', 404], ['/%ff', 400], ['/missing', 404]]) {
          assert.equal((await request(server.port, name)).status, expected, name);
        }
        const post = await request(server.port, '/', 'POST');
        assert.equal(post.status, 405);
        assert.equal(post.headers.allow, 'GET, HEAD');
      } finally {
        await server.close();
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('server arguments fail with actionable errors', () => {
  for (const args of [['--port', '0'], ['--port', '65536'], ['--port'], ['--unknown']]) {
    const result = spawnSync(process.execPath, ['scripts/serve.js', ...args], { cwd: root, encoding: 'utf8', timeout: 5000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /backoff-lab server:/);
  }
});

test('preview requires a built directory and refuses a symlink for dist', async () => {
  const directory = await fixture();
  try {
    for (const linked of [false, true]) {
      if (linked) await symlink(directory, path.join(directory, 'dist'));
      const result = spawnSync(process.execPath, ['scripts/serve.js', '--dist'], { cwd: directory, encoding: 'utf8', timeout: 5000 });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Run npm run build first/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
