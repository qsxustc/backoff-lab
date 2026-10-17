import { copyFile, lstat, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'dist');
// Keep the public roots in sync with scripts/serve.js.
const files = ['index.html', 'styles.css', 'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'LICENSE'];
const directories = ['src', 'assets', 'docs', 'examples'];

async function copyPublic(source, target, expectedType) {
  const info = await lstat(source);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
    throw new Error(`Build inputs must be regular files or directories, not links: ${path.relative(root, source)}`);
  }
  if ((expectedType === 'file' && !info.isFile()) || (expectedType === 'directory' && !info.isDirectory())) {
    throw new Error(`Unexpected build input: ${path.relative(root, source)}`);
  }
  if (info.isFile()) {
    await copyFile(source, target);
    return;
  }
  await mkdir(target);
  for (const name of await readdir(source)) {
    if (name.startsWith('.')) continue;
    await copyPublic(path.join(source, name), path.join(target, name));
  }
}

// Complete and validate a staging directory before moving the existing build.
const staging = await mkdtemp(path.join(root, '.backoff-build-'));
let backup;
try {
  for (const entry of files) await copyPublic(path.join(root, entry), path.join(staging, entry), 'file');
  for (const entry of directories) await copyPublic(path.join(root, entry), path.join(staging, entry), 'directory');
  let previous;
  try {
    previous = await lstat(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous) {
    if (!previous.isDirectory() || previous.isSymbolicLink()) throw new Error('dist must be a regular directory.');
    backup = await mkdtemp(path.join(root, '.backoff-previous-'));
    await rename(destination, path.join(backup, 'dist'));
  }
  try {
    await rename(staging, destination);
  } catch (error) {
    if (backup) {
      // If restoration fails, leave the backup in place for recovery.
      await rename(path.join(backup, 'dist'), destination);
    }
    throw error;
  }
  if (backup) await rm(backup, { recursive: true, force: true });
  console.log('Built static site in dist/ (no dependencies required).');
} finally {
  await rm(staging, { recursive: true, force: true });
}
