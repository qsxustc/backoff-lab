import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SCENARIO, POLICIES, compare } from '../src/simulator.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = (...args) => spawnSync(process.execPath, ['bin/backoff-lab.js', ...args], {
  cwd: root,
  encoding: 'utf8',
  timeout: 20_000,
});

test('help explains options and policies without starting a server', () => {
  const result = cli('--help');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: backoff-lab/);
  assert.match(result.stdout, /--scenario/);
  assert.ok(result.stdout.includes(POLICIES[0].id));
});

test('bad arguments exit nonzero with useful errors', () => {
  for (const args of [['--wat'], ['--format', 'xml'], ['--policy', 'unknown-policy'], ['--scenario']]) {
    const result = cli(...args);
    assert.notEqual(result.status, 0, args.join(' '));
    assert.match(result.stderr, /backoff-lab:/);
    assert.equal(result.stdout, '');
  }
});

test('default JSON matches simulator metrics and leaves out event payloads', () => {
  const result = cli('--format', 'json');
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.schemaVersion, 1);
  assert.deepEqual(data.scenario, DEFAULT_SCENARIO);
  assert.deepEqual(data.results, compare(DEFAULT_SCENARIO).map(({ policyId, metrics }) => ({ policyId, metrics })));
  assert.ok(data.results.every((row) => !Object.hasOwn(row, 'events')));
});

test('scenario input, policy selection, events, and file output work together', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'backoff-lab-cli-'));
  try {
    const scenario = { ...DEFAULT_SCENARIO, clients: 12, seed: 7 };
    const input = path.join(directory, 'scenario.json');
    const output = path.join(directory, 'report.json');
    await writeFile(input, JSON.stringify(scenario));
    const result = cli('--scenario', input, '--policy', POLICIES[0].id, '--format', 'json', '--events', '--output', output);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    const data = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual(data.scenario, scenario);
    assert.deepEqual(data.results, compare(scenario, [POLICIES[0].id]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unsafe, malformed, and invalid scenario inputs are rejected', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'backoff-lab-invalid-'));
  try {
    const cases = [
      ['large.json', ' '.repeat(65537), /64 KiB/],
      ['encoding.json', Buffer.from([0xc3, 0x28]), /UTF-8/],
      ['broken.json', '{broken', /valid JSON/],
      ['array.json', '[]', /JSON object/],
      ['null.json', 'null', /JSON object/],
      ['invalid.json', JSON.stringify({ ...DEFAULT_SCENARIO, clients: -1 }), /clients/i],
    ];
    for (const [name, content, expected] of cases) {
      const input = path.join(directory, name);
      await writeFile(input, content);
      const result = cli('--scenario', input, '--format', 'json');
      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, expected);
      assert.equal(result.stdout, '');
    }
    const result = cli('--scenario', directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /regular file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('output replaces ordinary files and never follows symbolic links', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'backoff-lab-output-'));
  try {
    const output = path.join(directory, 'report.json');
    await writeFile(output, 'old report');
    let result = cli('--format', 'json', '--output', output);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).schemaVersion, 1);

    const target = path.join(directory, 'protected.txt');
    const linked = path.join(directory, 'linked.json');
    await writeFile(target, 'preserve me');
    await symlink(target, linked);
    for (const invalid of [linked, directory]) {
      result = cli('--output', invalid);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /regular file/);
    }
    assert.equal(await readFile(target, 'utf8'), 'preserve me');
    assert.ok((await readdir(directory)).every((name) => !name.startsWith('.backoff-output-')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid input leaves an existing output untouched', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'backoff-lab-output-error-'));
  try {
    const input = path.join(directory, 'bad.json');
    const output = path.join(directory, 'report.json');
    await writeFile(input, '{');
    await writeFile(output, 'keep previous report');
    const result = cli('--scenario', input, '--output', output);
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(output, 'utf8'), 'keep previous report');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
