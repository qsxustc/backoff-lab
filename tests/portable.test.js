import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCENARIO, compare } from '../src/simulator.js';
import { encodeScenario, decodeScenario, attemptsCSV, reportHTML, escapeHTML } from '../src/portable.js';

test('shared scenario roundtrips all supported values and reproduces metrics', () => {
  const scenario = { ...DEFAULT_SCENARIO, seed: 4294967295, respectRetryAfter: true, retryAfterMs: 1200, spreadMs: 333 };
  const decoded = decodeScenario(encodeScenario(scenario));
  assert.deepEqual(decoded, scenario);
  assert.deepEqual(compare(decoded).map((r) => r.metrics), compare(scenario).map((r) => r.metrics));
  assert.match(encodeScenario(scenario), /^[A-Za-z0-9_-]+$/);
});

test('malformed and oversized links fail before simulation', () => {
  for (const value of ['', '#bad', 'x'.repeat(4097), 'a', btoa('{"clients":99999}'), btoa('{"secret":"x"}')]) {
    assert.throws(() => decodeScenario(value));
  }
});

test('CSV retains every attempt, one-based client IDs, and terminal status', () => {
  const results = compare({clients:3, outageMs:0,capacity:3});
  const csv = attemptsCSV(results);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 1 + results.reduce((total, result) => total + result.metrics.attempts, 0));
  assert.ok(lines[1].startsWith('"fixed","1","1","0","180","success","0","","success"'));
});

test('offline report includes reproducible input and honest failure/latency metrics', () => {
  const scenario = { ...DEFAULT_SCENARIO, clients:2, outageMs:0, capacity:2, deadlineMs:100 };
  const html = reportHTML(scenario, compare(scenario));
  assert.ok(html.includes('p95 / success'));
  assert.ok(html.includes('deadlineMs'));
  assert.ok(html.includes('<td>—</td>'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('src="http'));
  assert.equal(escapeHTML('<script>"&'), '&lt;script&gt;&quot;&amp;');
});
