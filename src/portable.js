import { validateScenario, POLICIES } from './simulator.js';

export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function encodeScenario(input) {
  const bytes = new TextEncoder().encode(JSON.stringify(validateScenario(input)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeScenario(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error('Invalid experiment link. Import a scenario JSON file instead.');
  }
  try {
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));
    return validateScenario(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (error) {
    throw new Error(`Cannot read experiment link: ${error.message}`);
  }
}

export function attemptsCSV(results) {
  const columns = ['policy', 'client_id', 'attempt', 'start_ms', 'end_ms', 'outcome', 'backoff_ms', 'next_start_ms', 'client_status'];
  const rows = results.flatMap((result) => result.events.map((event) => [result.policyId, event.clientId + 1, event.attempt,
    event.startMs, event.endMs, event.outcome, event.backoffMs, event.nextStartMs ?? '', result.clients[event.clientId].status]));
  return [columns, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
}

export function reportHTML(input, results) {
  const scenario = validateScenario(input);
  const rows = results.map((result) => {
    const metric = result.metrics;
    return `<tr><th>${escapeHTML(POLICIES.find((policy) => policy.id === result.policyId)?.name ?? result.policyId)}</th><td>${metric.successCount} / ${scenario.clients}</td><td>${metric.exhaustedCount}</td><td>${metric.deadlineCount}</td><td>${metric.attempts}</td><td>${metric.amplification.toFixed(2)}×</td><td>${metric.p95Ms === null ? '—' : `${metric.p95Ms} ms`}</td><td>${metric.peakRetryBin}</td></tr>`;
  }).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Backoff Lab — experiment report</title><style>body{font:15px/1.65 system-ui,sans-serif;background:#f7f8f2;color:#20332c;max-width:1100px;margin:50px auto;padding:0 24px}h1{font:44px Georgia,serif;letter-spacing:-1px}h2{font-size:19px;margin-top:36px}table{border-collapse:collapse;width:100%;background:white;font-size:13px}th,td{border-bottom:1px solid #dce3d4;padding:12px;text-align:right}th:first-child{text-align:left}pre{padding:20px;background:#eaf0e1;overflow:auto}code{font-size:12px}.table{overflow:auto}.label{font-size:11px;letter-spacing:2px;color:#137b63}p{max-width:850px}</style><p class="label">BACKOFF LAB / MODEL VERSION 1</p><h1>Same incident. Five ways to try again.</h1><p>A deterministic, synthetic burst experiment. Seed <strong>${scenario.seed}</strong>; ${scenario.clients} clients; ${scenario.capacity} concurrent service slots; outage ${scenario.outageMs} ms. This is a static snapshot.</p><div class="table"><table><thead><tr><th>Policy</th><th>Completed</th><th>Exhausted</th><th>Deadline</th><th>Attempts</th><th>Amplification</th><th>p95 / success</th><th>Peak retries / 100 ms</th></tr></thead><tbody>${rows}</tbody></table></div><h2>Read the tradeoffs</h2><p>p95 is the nearest-rank latency of successful clients, measured from each client's first arrival. It excludes unsuccessful clients. Amplification is total attempts divided by original clients. Peak retries excludes first attempts. All policies share the same initial arrivals and service costs.</p><h2>Model boundaries</h2><p>One finite burst, fixed response times, no queue, and fast outage/overload failures that do not consume service slots. Accepted work continues occupying a slot after a client deadline. Retry-After is a fixed simulated minimum delay after failure. No real traffic is sent. These results are not production capacity predictions or SDK compatibility guarantees.</p><h2>Reproduce this scenario</h2><p>Save this JSON as <code>scenario.json</code> and import it into Backoff Lab, or run <code>node bin/backoff-lab.js --scenario scenario.json --format json</code> from its checkout.</p><pre>${escapeHTML(JSON.stringify(scenario, null, 2))}</pre><p>Backoff Lab · MIT licensed · No external assets or scripts in this report.</p></html>`;
}
