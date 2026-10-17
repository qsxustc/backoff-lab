import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCENARIO, POLICIES, PRESETS, compare, simulate, validateScenario } from '../src/simulator.js';

test('the same seed reproduces the entire run, without mutating the input', () => {
  const input = { ...DEFAULT_SCENARIO, spreadMs: 300 };
  const snapshot = { ...input };
  assert.deepEqual(simulate(input, 'full'), simulate(input, 'full'));
  assert.deepEqual(input, snapshot);
  assert.notDeepEqual(simulate(input, 'full').events, simulate({ ...input, seed: 43 }, 'full').events);
});

test('healthy capacity serves exactly one attempt per client', () => {
  for (const policy of POLICIES) {
    const result = simulate({ clients: 40, capacity: 40, outageMs: 0 }, policy.id);
    assert.equal(result.metrics.successCount, 40);
    assert.equal(result.metrics.attempts, 40);
    assert.equal(result.metrics.retries, 0);
    assert.equal(result.metrics.p95Ms, 180);
    assert.equal(result.metrics.amplification, 1);
    assert.ok(result.clients.every((client) => client.completedAtMs === 180 && client.status === 'success'));
  }
});

test('accepted requests obey concurrency capacity, including same-time releases', () => {
  const result = simulate({ clients: 100, capacity: 3, outageMs: 0, latencyMs: 120,
    failureLatencyMs: 20, baseDelayMs: 100, maxDelayMs: 100, maxAttempts: 20 }, 'fixed');
  const changes = result.events.filter((event) => event.outcome === 'success').flatMap((event) => [
    { time: event.startMs, delta: 1 }, { time: event.endMs, delta: -1 },
  ]).sort((a, b) => a.time - b.time || a.delta - b.delta);
  let active = 0;
  for (const change of changes) {
    active += change.delta;
    assert.ok(active >= 0 && active <= 3);
  }
  assert.equal(active, 0);
  const boundary = simulate({ clients: 2, capacity: 1, outageMs: 0, latencyMs: 120,
    failureLatencyMs: 20, baseDelayMs: 100 }, 'fixed');
  assert.equal(boundary.clients[1].events[1].startMs, 120);
  assert.equal(boundary.metrics.successCount, 2);
});

test('maxAttempts includes the first attempt and exhaustion is finite', () => {
  const result = simulate({ clients: 7, outageMs: 120000, maxAttempts: 3 }, 'fixed');
  assert.equal(result.metrics.attempts, 21);
  assert.equal(result.metrics.retries, 14);
  assert.equal(result.metrics.exhaustedCount, 7);
  assert.equal(result.metrics.deadlineCount, 0);
  assert.equal(result.metrics.p95Ms, null);
  assert.ok(result.clients.every((client) => client.events.length === 3 && client.completedAtMs === null));
});

test('a response exceeding the deadline becomes a deadline, and background work retains capacity', () => {
  const result = simulate({ clients: 40, capacity: 1, outageMs: 0, latencyMs: 1000,
    deadlineMs: 100, spreadMs: 700, failureLatencyMs: 10, maxAttempts: 20,
    baseDelayMs: 10, maxDelayMs: 10 }, 'fixed');
  assert.equal(result.metrics.successCount, 0);
  assert.equal(result.events.filter((event) => event.outcome === 'deadline' && event.attempt === 1).length, 1);
  const first = result.events[0];
  assert.equal(first.outcome, 'deadline');
  assert.equal(first.endMs - first.startMs, 100);
  assert.ok(result.events.slice(1).every((event) => event.outcome === 'overload'
    || event.outcome === 'deadline'));
  assert.equal(result.metrics.deadlineCount, 40);
});

test('a response exactly at its deadline succeeds', () => {
  const result = simulate({ clients: 1, outageMs: 0, latencyMs: 100, deadlineMs: 100 }, 'full');
  assert.equal(result.clients[0].status, 'success');
  assert.equal(result.metrics.p95Ms, 100);
});

test('retries at or past the deadline are never sent', () => {
  const result = simulate({ clients: 1, outageMs: 120000, failureLatencyMs: 50,
    baseDelayMs: 150, deadlineMs: 200 }, 'fixed');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].nextStartMs, undefined);
  assert.equal(result.clients[0].status, 'deadline');
  assert.equal(result.metrics.durationMs, 200);
  assert.equal(result.bins.reduce((sum, bin) => sum + bin.deadline, 0), 1);
});

test('full and equal jitter remain inside their exponential windows', () => {
  const input = { clients: 100, outageMs: 120000, baseDelayMs: 101,
    maxDelayMs: 1000, maxAttempts: 8, deadlineMs: 120000 };
  for (const policyId of ['full', 'equal']) {
    const result = simulate(input, policyId);
    const delays = new Set();
    for (const event of result.events.filter((event) => event.attempt > 1)) {
      const cap = Math.min(input.maxDelayMs, input.baseDelayMs * 2 ** (event.attempt - 2));
      assert.ok(event.backoffMs >= (policyId === 'equal' ? Math.ceil(cap / 2) : 0));
      assert.ok(event.backoffMs <= cap);
      delays.add(event.backoffMs);
    }
    assert.ok(delays.size > 100, 'clients should draw different waits');
  }
});

test('decorrelated jitter uses its previous policy delay and respects the cap', () => {
  const result = simulate({ clients: 40, outageMs: 120000, maxAttempts: 10,
    deadlineMs: 120000, baseDelayMs: 100, maxDelayMs: 700 }, 'decorrelated');
  for (const client of result.clients) {
    let previous = 100;
    for (const event of client.events.slice(1)) {
      assert.ok(event.backoffMs >= 100 && event.backoffMs <= Math.min(700, previous * 3));
      previous = event.backoffMs;
    }
  }
});

test('Retry-After waits at least its value after the response for every policy', () => {
  const input = { clients: 20, outageMs: 120000, retryAfterMs: 1300, respectRetryAfter: true,
    maxAttempts: 5, deadlineMs: 120000 };
  for (const policy of POLICIES) {
    const result = simulate(input, policy.id);
    for (const event of result.events) {
      if (event.nextStartMs !== undefined) assert.ok(event.nextStartMs - event.endMs >= 1300);
      if (event.attempt > 1) assert.ok(event.backoffMs >= 1300);
    }
  }
  const ignored = simulate({ ...input, respectRetryAfter: false }, 'fixed');
  assert.equal(ignored.clients[0].events[1].backoffMs, DEFAULT_SCENARIO.baseDelayMs);
});

test('all policies use identical arrivals; each client has an independent random stream', () => {
  const runs = compare({ spreadMs: 500 });
  const arrivals = runs[0].clients.map((client) => client.startedAtMs);
  assert.ok(runs.every((run) => JSON.stringify(run.clients.map((client) => client.startedAtMs)) === JSON.stringify(arrivals)));
  const solo = simulate({ clients: 1, capacity: 1, outageMs: 120000, spreadMs: 500 }, 'full');
  const crowd = simulate({ clients: 80, capacity: 1, outageMs: 120000, spreadMs: 500 }, 'full');
  assert.deepEqual(solo.clients[0].events, crowd.clients[0].events);
});

test('metrics and bins conserve requests and terminal clients', () => {
  for (const { scenario } of PRESETS) {
    for (const result of compare(scenario)) {
      const sum = (key) => result.bins.reduce((total, bin) => total + bin[key], 0);
      assert.equal(sum('initial'), scenario.clients);
      assert.equal(sum('retry'), result.metrics.retries);
      assert.equal(sum('success'), result.metrics.successCount);
      assert.equal(sum('deadline'), result.metrics.deadlineCount);
      assert.equal(result.metrics.successCount + result.metrics.exhaustedCount + result.metrics.deadlineCount, scenario.clients);
      assert.equal(result.events.length, result.metrics.attempts);
      for (const client of result.clients) {
        for (let index = 1; index < client.events.length; index++) {
          const previous = client.events[index - 1];
          const current = client.events[index];
          assert.equal(previous.nextStartMs, current.startMs);
          assert.equal(current.startMs - previous.endMs, current.backoffMs);
        }
      }
    }
  }
});

test('invalid scenarios and policies fail with useful errors', () => {
  const invalid = [null, [], 'scenario', new Date(), { clients: 0 }, { clients: 501 },
    { clients: 1.5 }, { maxAttempts: 21 }, { seed: -1 }, { seed: Infinity },
    { deadlineMs: 99 }, { latencyMs: 0 }, { failureLatencyMs: NaN }, { version: 2 },
    { maxDelayMs: 100, baseDelayMs: 200 }, { respectRetryAfter: 'true' },
    { client: 40 }, { clients: undefined }];
  for (const input of invalid) assert.throws(() => validateScenario(input), Error);
  assert.throws(() => simulate({}, 'mystery'), /Unknown policy/);
  assert.throws(() => compare({}, []), /non-empty array/);
  assert.throws(() => compare({}, ['full', 'full']), /duplicates/);
  assert.throws(() => compare({}, ['bad']), /Unknown policy/);
  assert.deepEqual(validateScenario({}), DEFAULT_SCENARIO);
});
