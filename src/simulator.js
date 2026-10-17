/**
 * A deterministic, discrete-event simulation of a finite burst of requests.
 * Times are integer milliseconds. No network requests or wall-clock timers run.
 */

export const DEFAULT_SCENARIO = Object.freeze({
  version: 1,
  clients: 120,
  outageMs: 1500,
  capacity: 12,
  latencyMs: 180,
  failureLatencyMs: 60,
  baseDelayMs: 180,
  maxDelayMs: 4000,
  maxAttempts: 10,
  deadlineMs: 15000,
  spreadMs: 0,
  seed: 42,
  retryAfterMs: 0,
  respectRetryAfter: false,
});

export const POLICIES = Object.freeze([
  Object.freeze({
    id: 'fixed', name: 'Fixed delay', color: '#f17f62',
    description: 'Every client waits the same interval after each failure.',
    formula: 'sleep = base',
  }),
  Object.freeze({
    id: 'exponential', name: 'Exponential', color: '#f4c267',
    description: 'The wait doubles after each failure, up to the cap.',
    formula: 'sleep = min(cap, base × 2ⁿ)',
  }),
  Object.freeze({
    id: 'full', name: 'Full jitter', color: '#76d6b6',
    description: 'Choose a fresh random wait anywhere inside the exponential window.',
    formula: 'sleep = random(0, min(cap, base × 2ⁿ))',
  }),
  Object.freeze({
    id: 'equal', name: 'Equal jitter', color: '#92bafa',
    description: 'Keep half the exponential delay and randomize the other half.',
    formula: 'window = min(cap, base × 2ⁿ); sleep = window/2 + random(0, window/2)',
  }),
  Object.freeze({
    id: 'decorrelated', name: 'Decorrelated jitter', color: '#c5a5ef',
    description: 'Choose the next wait from the base delay to three times the previous wait.',
    formula: 'sleep = min(cap, random(base, previous × 3))',
  }),
]);

function preset(id, name, description, overrides) {
  return Object.freeze({ id, name, description, scenario: Object.freeze({ ...DEFAULT_SCENARIO, ...overrides }) });
}

export const PRESETS = Object.freeze([
  preset('thundering-herd', 'Thundering herd', '120 clients start together during a 1.5-second outage.', {}),
  preset('overloaded', 'Small server, big burst', 'A healthy server has room for only eight requests at once.', {
    clients: 220, outageMs: 0, capacity: 8, latencyMs: 300, baseDelayMs: 100,
  }),
  preset('retry-after', 'Retry-After', 'A recovering service asks clients to wait at least 1.2 seconds.', {
    clients: 180, outageMs: 1200, capacity: 12, retryAfterMs: 1200, respectRetryAfter: true,
  }),
  preset('staggered', 'Staggered arrivals', 'Spread the same burst across two seconds before retrying.', {
    spreadMs: 2000,
  }),
]);

const LIMITS = Object.freeze({
  clients: [1, 500],
  outageMs: [0, 120000],
  capacity: [1, 500],
  latencyMs: [1, 30000],
  failureLatencyMs: [1, 30000],
  baseDelayMs: [1, 60000],
  maxDelayMs: [1, 120000],
  maxAttempts: [1, 20],
  deadlineMs: [100, 120000],
  spreadMs: [0, 120000],
  seed: [0, 4294967295],
  retryAfterMs: [0, 120000],
});

/** Accept a partial scenario, fill defaults, and reject typos and unsafe values. */
export function validateScenario(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new Error('Scenario must be a plain object.');
  }
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(DEFAULT_SCENARIO, key)) throw new Error(`Unknown scenario field: ${key}.`);
  }
  const scenario = { ...DEFAULT_SCENARIO, ...input };
  if (scenario.version !== 1) throw new Error('Scenario version must be 1.');
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const value = scenario[key];
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${key} must be an integer between ${min} and ${max}.`);
    }
  }
  if (typeof scenario.respectRetryAfter !== 'boolean') {
    throw new Error('respectRetryAfter must be a boolean.');
  }
  if (scenario.maxDelayMs < scenario.baseDelayMs) {
    throw new Error('maxDelayMs must be greater than or equal to baseDelayMs.');
  }
  return scenario;
}

// Each client owns its random stream. Extra retries by one client cannot alter
// another client's arrivals or jitter. The initial draw is reserved for arrivals.
function randomForClient(seed, clientId) {
  let state = (seed ^ Math.imul(clientId + 1, 0x9e3779b9)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInteger(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

// A binary heap keeps work proportional to actual attempts, not elapsed time.
// Releases sort before responses and arrivals at the same instant, so a slot
// finishing at t is available to a request starting at t.
class EventQueue {
  items = [];
  sequence = 0;

  before(a, b) {
    return a.time < b.time || (a.time === b.time
      && (a.priority < b.priority || (a.priority === b.priority && a.sequence < b.sequence)));
  }

  push(event) {
    event.sequence = this.sequence++;
    const items = this.items;
    items.push(event);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (!this.before(items[index], items[parent])) break;
      [items[index], items[parent]] = [items[parent], items[index]];
      index = parent;
    }
  }

  pop() {
    const items = this.items;
    const first = items[0];
    const last = items.pop();
    if (items.length === 0) return first;
    items[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= items.length) break;
      const child = right < items.length && this.before(items[right], items[left]) ? right : left;
      if (!this.before(items[child], items[index])) break;
      [items[index], items[child]] = [items[child], items[index]];
      index = child;
    }
    return first;
  }
}

function backoff(policyId, scenario, client, failedAttempt) {
  const window = Math.min(scenario.maxDelayMs, scenario.baseDelayMs * 2 ** (failedAttempt - 1));
  let delay;
  switch (policyId) {
    case 'fixed': delay = scenario.baseDelayMs; break;
    case 'exponential': delay = window; break;
    case 'full': delay = randomInteger(client.random, 0, window); break;
    case 'equal': delay = randomInteger(client.random, Math.ceil(window / 2), window); break;
    case 'decorrelated':
      delay = Math.min(scenario.maxDelayMs,
        randomInteger(client.random, scenario.baseDelayMs, client.previousDelay * 3));
      break;
    default: throw new Error(`Unknown policy: ${String(policyId)}.`);
  }
  client.previousDelay = delay;
  return scenario.respectRetryAfter ? Math.max(delay, scenario.retryAfterMs) : delay;
}

/**
 * Run a burst against a server with a finite concurrent-request capacity.
 * maxAttempts includes the initial request. Deadlines are relative to each
 * client's first arrival. A timed-out accepted request keeps its server slot
 * until its real completion, although its client stops waiting at the deadline.
 */
export function simulate(input = {}, policyId = 'full') {
  const scenario = validateScenario(input);
  if (!POLICIES.some((policy) => policy.id === policyId)) {
    throw new Error(`Unknown policy: ${String(policyId)}.`);
  }
  const queue = new EventQueue();
  const events = [];
  const clients = [];
  const internalClients = [];
  let activeRequests = 0;
  let durationMs = 0;

  for (let id = 0; id < scenario.clients; id++) {
    const random = randomForClient(scenario.seed, id);
    const arrivalDraw = random();
    const startedAtMs = Math.floor(arrivalDraw * (scenario.spreadMs + 1));
    const client = { id, startedAtMs, status: null, completedAtMs: null, events: [] };
    clients.push(client);
    internalClients.push({ client, random, previousDelay: scenario.baseDelayMs,
      deadline: startedAtMs + scenario.deadlineMs });
    queue.push({ time: startedAtMs, priority: 2, kind: 'start', id, attempt: 1, backoffMs: 0 });
  }

  function finish(client, status, time) {
    client.status = status;
    if (status === 'success') client.completedAtMs = time;
    durationMs = Math.max(durationMs, time);
  }

  while (queue.items.length > 0) {
    const action = queue.pop();
    if (action.kind === 'release') {
      activeRequests--;
      continue;
    }
    const state = internalClients[action.id];
    const { client, deadline } = state;

    if (action.kind === 'start') {
      const startMs = action.time;
      let outcome;
      if (startMs < scenario.outageMs) outcome = 'outage';
      else if (activeRequests >= scenario.capacity) outcome = 'overload';
      else outcome = 'success';

      const actualEnd = startMs + (outcome === 'success' ? scenario.latencyMs : scenario.failureLatencyMs);
      if (outcome === 'success') {
        activeRequests++;
        queue.push({ time: actualEnd, priority: 0, kind: 'release' });
      }
      const event = {
        clientId: action.id,
        attempt: action.attempt,
        startMs,
        endMs: Math.min(actualEnd, deadline),
        outcome: actualEnd > deadline ? 'deadline' : outcome,
        backoffMs: action.backoffMs,
      };
      events.push(event);
      client.events.push(event);
      queue.push({ time: event.endMs, priority: 1, kind: 'response', id: action.id, event });
      continue;
    }

    const { event } = action;
    if (event.outcome === 'success') finish(client, 'success', action.time);
    else if (event.outcome === 'deadline') finish(client, 'deadline', action.time);
    else if (event.attempt >= scenario.maxAttempts) finish(client, 'exhausted', action.time);
    else {
      const delay = backoff(policyId, scenario, state, event.attempt);
      const nextStartMs = action.time + delay;
      if (nextStartMs >= deadline) {
        // The client waits until its budget expires; no phantom attempt is sent.
        finish(client, 'deadline', deadline);
      } else {
        event.nextStartMs = nextStartMs;
        queue.push({ time: nextStartMs, priority: 2, kind: 'start', id: action.id,
          attempt: event.attempt + 1, backoffMs: delay });
      }
    }
  }

  const bins = Array.from({ length: Math.floor(durationMs / 100) + 1 }, (_, index) => ({
    startMs: index * 100, initial: 0, retry: 0, success: 0, outage: 0, overload: 0, deadline: 0,
  }));
  for (const event of events) {
    bins[Math.floor(event.startMs / 100)][event.attempt === 1 ? 'initial' : 'retry']++;
    // Deadlines count terminal clients, including clients whose next retry was
    // outside the budget; other outcome counters count observed responses.
    if (event.outcome !== 'deadline') bins[Math.floor(event.endMs / 100)][event.outcome]++;
  }
  for (const client of clients) {
    if (client.status === 'deadline') {
      bins[Math.floor((client.startedAtMs + scenario.deadlineMs) / 100)].deadline++;
    }
  }
  const successes = clients.filter((client) => client.status === 'success');
  const latencies = successes.map((client) => client.completedAtMs - client.startedAtMs).sort((a, b) => a - b);
  const successCount = successes.length;
  const exhaustedCount = clients.filter((client) => client.status === 'exhausted').length;
  return {
    policyId,
    scenario,
    events,
    clients,
    metrics: {
      attempts: events.length,
      retries: events.length - scenario.clients,
      successCount,
      exhaustedCount,
      deadlineCount: scenario.clients - successCount - exhaustedCount,
      p95Ms: latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : null,
      amplification: events.length / scenario.clients,
      peakRetryBin: bins.reduce((peak, bin) => Math.max(peak, bin.retry), 0),
      durationMs,
    },
    bins,
  };
}

/** Compare policies using identical arrivals and the same input seed. */
export function compare(input = {}, policyIds = POLICIES.map((policy) => policy.id)) {
  if (!Array.isArray(policyIds) || policyIds.length === 0 || policyIds.length > POLICIES.length) {
    throw new Error('policyIds must be a non-empty array of at most five policy IDs.');
  }
  if (new Set(policyIds).size !== policyIds.length) throw new Error('policyIds must not contain duplicates.');
  const scenario = validateScenario(input);
  return policyIds.map((policyId) => simulate(scenario, policyId));
}
