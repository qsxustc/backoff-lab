import { DEFAULT_SCENARIO, PRESETS, POLICIES, validateScenario, compare } from './simulator.js';
import { escapeHTML as esc, encodeScenario, decodeScenario, attemptsCSV, reportHTML } from './portable.js';

const $ = (id) => document.getElementById(id);
const colors = { success: '#278668', outage: '#cd806a', overload: '#b6934c', deadline: '#7986aa' };
const policy = (id) => POLICIES.find((item) => item.id === id);
const seconds = (ms) => ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`;
const shortTime = (ms) => ms < 1000 ? `${ms} ms` : `${+(ms / 1000).toFixed(2)} s`;
const fields = [
  ['clients', 'Clients in the burst', 1, 500, 1, 'clients'],
  ['outageMs', 'Service recovers after', 0, 10000, 50, 'time'],
  ['capacity', 'Concurrent service slots', 1, 100, 1, 'slots'],
  ['latencyMs', 'Successful response time', 10, 1000, 10, 'time'],
  ['baseDelayMs', 'Base retry delay', 10, 2000, 10, 'time'],
  ['deadlineMs', 'Client time budget', 100, 30000, 100, 'time'],
  ['maxAttempts', 'Maximum attempts', 1, 20, 1, 'attempts'],
  ['maxDelayMs', 'Backoff cap', 10, 15000, 10, 'time'],
  ['failureLatencyMs', 'Failure response time', 1, 1000, 1, 'time'],
  ['spreadMs', 'Initial arrival spread', 0, 10000, 50, 'time'],
];
let scenario = { ...DEFAULT_SCENARIO };
let results = [];
let selectedClient = 0;
let page = 0;
let playFrame = 0;
let playing = false;
let activePreset = PRESETS[0].id;
let noticeTimer;

function notice(message, error = false) {
  clearTimeout(noticeTimer);
  $('notice').hidden = false;
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  if (!error) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6000);
}

function drawControls() {
  for (const [index, field] of fields.entries()) {
    const [id, name, min, max, step, unit] = field;
    const container = document.createElement('div');
    container.className = 'control';
    container.innerHTML = `<label class="control-label" for="${id}"><span>${name}</span><output id="${id}-value" for="${id}"></output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}"><div class="control-bounds"><span>${unit === 'time' ? shortTime(min) : min}</span><span>${unit === 'time' ? shortTime(max) : max}</span></div>`;
    $(index < 6 ? 'primary-controls' : 'advanced-controls').append(container);
  }
  $('presets').innerHTML = PRESETS.slice(0, 3).map((preset, index) => `<button class="preset-button" data-preset="${preset.id}" title="${esc(preset.description)}">${['Recovery burst', 'Busy server', 'Retry-After'][index]}</button>`).join('');
  const options = POLICIES.map((item) => `<option value="${item.id}">${item.name}</option>`).join('');
  for (const id of ['baseline', 'candidate', 'timeline-policy']) $(id).innerHTML = options;
  $('baseline').value = 'exponential';
  $('candidate').value = 'full';
  $('timeline-policy').value = 'full';
  syncControls(true);
}

function syncControls(resetRanges = false) {
  for (const [id, , min, max, step, unit] of fields) {
    const input = $(id);
    // Imported scenarios may use wider, engine-supported ranges. Keep the exact
    // imported value visible and editable instead of silently clamping it.
    input.min = Math.min(resetRanges ? min : Number(input.min), scenario[id]);
    input.max = Math.max(resetRanges ? max : Number(input.max), scenario[id]);
    const retainedStep = resetRanges ? step : Number(input.step);
    input.step = (scenario[id] - Number(input.min)) % retainedStep === 0 ? retainedStep : 1;
    input.value = scenario[id];
    $(`${id}-value`).value = unit === 'time' ? shortTime(scenario[id]) : scenario[id];
    const bounds = input.nextElementSibling.children;
    bounds[0].textContent = unit === 'time' ? shortTime(Number(input.min)) : input.min;
    bounds[1].textContent = unit === 'time' ? shortTime(Number(input.max)) : input.max;
  }
  $('respectRetryAfter').checked = scenario.respectRetryAfter;
  $('retryAfterMs').max = 120000;
  $('retryAfterMs').value = scenario.retryAfterMs;
  $('seed').value = scenario.seed;
  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.classList.toggle('active', button.dataset.preset === activePreset);
    button.setAttribute('aria-pressed', String(button.dataset.preset === activePreset));
  });
}

function resultFor(id) { return results.find((result) => result.policyId === id); }
function metricCard(label, before, after, note) {
  return `<article class="metric"><span class="metric-label">${label}</span><div class="metric-values"><span class="before">${before}</span><span class="arrow">→</span><span class="after">${after}</span></div><p class="metric-note">${note}</p></article>`;
}

function renderComparison() {
  const baseline = resultFor($('baseline').value);
  const candidate = resultFor($('candidate').value);
  const a = baseline.metrics;
  const b = candidate.metrics;
  $('metrics').innerHTML = metricCard('Clients completed', `${Math.round(a.successCount / scenario.clients * 100)}%`, `${Math.round(b.successCount / scenario.clients * 100)}%`, `${a.successCount} → ${b.successCount} of ${scenario.clients} clients`)
    + metricCard('Request amplification', `${a.amplification.toFixed(1)}×`, `${b.amplification.toFixed(1)}×`, `${a.attempts.toLocaleString()} → ${b.attempts.toLocaleString()} attempts`)
    + metricCard('Peak retry pressure', a.peakRetryBin, b.peakRetryBin, 'retries in the busiest 100 ms');
  const duration = Math.max(100, Math.ceil(Math.max(a.durationMs, b.durationMs) / 100) * 100);
  const max = Math.max(1, ...baseline.bins.map((bin) => bin.initial + bin.retry), ...candidate.bins.map((bin) => bin.initial + bin.retry));
  $('pressure-charts').innerHTML = [baseline, candidate].map((result, index) => pressureChart(result, duration, max, index)).join('');
  const difference = a.attempts - b.attempts;
  const requestText = difference === 0 ? 'uses the same number of attempts' : `uses ${Math.abs(difference).toLocaleString()} ${difference > 0 ? 'fewer' : 'more'} attempts`;
  $('comparison-insight').textContent = `In this experiment, ${policy(candidate.policyId).name} ${requestText} than ${policy(baseline.policyId).name} and completes ${b.successCount}/${scenario.clients} clients. Successful-client p95: ${seconds(a.p95Ms)} → ${seconds(b.p95Ms)}. Change the scenario to test the tradeoff.`;
}

function pressureChart(result, duration, max, index) {
  const width = 600, left = 25, right = 590, top = 12, bottom = 77;
  const plotWidth = right - left;
  const x = (time) => left + time / duration * plotWidth;
  const height = (count) => count / max * (bottom - top);
  const color = index === 0 ? '#bb8368' : '#137b63';
  const bars = result.bins.filter((bin) => bin.initial + bin.retry > 0).map((bin) => {
    const barWidth = Math.max(.6, Math.min(x(100) - left - .5, right - x(bin.startMs)));
    const initialHeight = height(bin.initial), retryHeight = height(bin.retry);
    return `<g><title>${shortTime(bin.startMs)}–${shortTime(bin.startMs + 100)}: ${bin.initial} first attempts, ${bin.retry} retries</title><rect x="${x(bin.startMs)}" y="${bottom - initialHeight}" width="${barWidth}" height="${initialHeight}" fill="#b5c2ae"/><rect x="${x(bin.startMs)}" y="${bottom - initialHeight - retryHeight}" width="${barWidth}" height="${retryHeight}" fill="${color}"/></g>`;
  }).join('');
  const ticks = Array.from({ length: 5 }, (_, i) => `<line class="svg-axis" x1="${x(duration * i / 4)}" x2="${x(duration * i / 4)}" y1="${top}" y2="${bottom}"/><text class="svg-label" text-anchor="${i === 4 ? 'end' : 'start'}" x="${x(duration * i / 4)}" y="96">${+(duration * i / 4000).toFixed(1)} s</text>`).join('');
  return `<div class="pressure-row"><div class="pressure-label" style="color:${color}">${policy(result.policyId).name}<small>${result.metrics.attempts} attempts</small></div><svg class="pressure-chart" viewBox="0 0 ${width} 104" role="img" aria-label="${policy(result.policyId).name}: ${result.metrics.attempts} attempts, peak ${result.metrics.peakRetryBin} retries per 100 milliseconds"><rect x="${left}" y="${top}" width="${Math.min(scenario.outageMs / duration, 1) * plotWidth}" height="${bottom - top}" fill="#f7eee3"/>${ticks}<line class="svg-axis" x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}"/><text class="svg-label" x="0" y="${top + 4}">${max}</text><text class="svg-label" x="7" y="${bottom}">0</text>${bars}</svg></div>`;
}

function renderRaster() {
  const result = resultFor($('timeline-policy').value);
  const count = 32;
  page = Math.max(0, Math.min(page, Math.ceil(scenario.clients / count) - 1));
  const clients = result.clients.slice(page * count, (page + 1) * count);
  const duration = Math.max(100, result.metrics.durationMs);
  const width = 730, left = 45, right = 720, top = 24, rowHeight = 10;
  const bottom = top + clients.length * rowHeight;
  const x = (time) => left + time / duration * (right - left);
  const grid = Array.from({ length: 5 }, (_, i) => `<line class="svg-axis" x1="${x(duration * i / 4)}" x2="${x(duration * i / 4)}" y1="18" y2="${bottom}"/><text class="svg-label" text-anchor="${i === 4 ? 'end' : 'start'}" x="${x(duration * i / 4)}" y="10">${+(duration * i / 4000).toFixed(1)} s</text>`).join('');
  const rows = clients.map((client, index) => {
    const y = top + index * rowHeight;
    return `<g class="raster-row" data-client="${client.id}" role="button" tabindex="0" aria-label="Inspect client ${client.id + 1}: ${client.events.length} attempts, ${client.status}" aria-pressed="${client.id === selectedClient}"><rect class="row-background" x="0" y="${y - 5}" width="${width}" height="${rowHeight}" fill="${client.id === selectedClient ? '#eaf1df' : 'transparent'}"/><text class="svg-label" x="4" y="${y + 3}">${String(client.id + 1).padStart(3, '0')}</text><line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#f0f2eb"/>${client.events.map((event) => `<g class="event-marker" data-start="${event.startMs}"><title>Client ${client.id + 1} / attempt ${event.attempt}: ${event.startMs}–${event.endMs} ms, ${event.outcome}; waited ${event.backoffMs} ms</title><rect x="${x(event.startMs)}" y="${y - 2.4}" width="${Math.max(3, x(event.endMs) - x(event.startMs))}" height="4.8" rx="1" fill="${colors[event.outcome]}"/></g>`).join('')}</g>`;
  }).join('');
  $('raster').innerHTML = `<svg class="raster-svg" viewBox="0 0 ${width} ${bottom + 7}" role="group" aria-label="Client attempt timeline. Select a row to inspect."><rect x="${left}" y="18" width="${Math.min(scenario.outageMs / duration, 1) * (right - left)}" height="${bottom - 18}" fill="#faf1e6"/>${grid}${rows}<line id="raster-playhead" x1="${right}" x2="${right}" y1="18" y2="${bottom}" stroke="#335b47" stroke-width="1" stroke-dasharray="3 3" pointer-events="none"/></svg>`;
  $('raster-caption').innerHTML = `<button class="text-button" id="previous-clients" aria-label="Previous clients" ${page === 0 ? 'disabled' : ''}>←</button> Clients ${page * count + 1}–${page * count + clients.length} of ${scenario.clients} <button class="text-button" id="next-clients" aria-label="Next clients" ${(page + 1) * count >= scenario.clients ? 'disabled' : ''}>→</button>`;
  $('previous-clients').onclick = () => { page--; renderRaster(); };
  $('next-clients').onclick = () => { page++; renderRaster(); };
  updatePlayback();
  renderInspector();
}

function renderInspector() {
  const result = resultFor($('timeline-policy').value);
  const client = result.clients[selectedClient];
  const selectedPolicy = policy(result.policyId);
  const terminal = client.status === 'success' ? `completed in ${seconds(client.completedAtMs - client.startedAtMs)}` : client.status === 'exhausted' ? 'attempt budget exhausted' : 'time budget expired';
  $('client-inspector').innerHTML = `<div class="inspector-heading"><label for="inspect-client"><strong>INSPECT CLIENT</strong> <select id="inspect-client" aria-label="Client to inspect">${result.clients.map((item) => `<option value="${item.id}" ${item.id === selectedClient ? 'selected' : ''}>#${String(item.id + 1).padStart(3, '0')}</option>`).join('')}</select></label><span class="status-tag ${client.status === 'success' ? '' : 'failed'}">${terminal}</span></div><div class="formula">${esc(selectedPolicy.formula)}${scenario.respectRetryAfter ? `<br>effective sleep = max(sleep, ${scenario.retryAfterMs} ms Retry-After)` : ''}</div><p class="inspector-note">${esc(selectedPolicy.description)} n = 0 for the first retry; waits are integer milliseconds. Attempt times below are absolute from experiment start.</p><div class="attempt-list">${client.events.map((event) => `<div class="attempt-chip ${event.outcome}"><strong>#${event.attempt} · ${event.outcome === 'overload' ? 'busy' : event.outcome}</strong><span>sent ${shortTime(event.startMs)}</span><span>response ${shortTime(event.endMs)}</span><span>${event.attempt === 1 ? 'initial attempt' : `waited ${event.backoffMs} ms`}</span></div>`).join('')}</div><p class="inspector-note">${client.status === 'deadline' && client.events.at(-1).outcome !== 'deadline' ? 'The next retry would start at or beyond the deadline, so it was never sent. ' : ''}${result.metrics.exhaustedCount} clients exhausted their attempts; ${result.metrics.deadlineCount} reached their time budget. Completed-client latency excludes both groups.</p>`;
  $('inspect-client').onchange = (event) => {
    selectedClient = Number(event.target.value);
    page = Math.floor(selectedClient / 32);
    renderRaster();
  };
}

function renderTable() {
  $('policy-table').innerHTML = results.map((result) => {
    const m = result.metrics;
    return `<tr class="${result.policyId === $('candidate').value ? 'table-current' : ''}"><td><span class="policy-dot" style="background:${policy(result.policyId).color}"></span>${policy(result.policyId).name}</td><td>${m.successCount}<small>/ ${scenario.clients}</small></td><td>${m.attempts.toLocaleString()}</td><td>${m.amplification.toFixed(2)}×</td><td>${seconds(m.p95Ms)}</td><td>${m.peakRetryBin}</td></tr>`;
  }).join('');
}

function stopPlayback() {
  cancelAnimationFrame(playFrame);
  playing = false;
  $('play').innerHTML = '▶ <span>Replay</span>';
  $('play').setAttribute('aria-label', 'Replay simulation');
}
function updatePlayback() {
  const result = resultFor($('timeline-policy').value);
  const fraction = Number($('playhead').value) / 1000;
  const time = fraction * Math.max(100, result.metrics.durationMs);
  $('playhead-label').value = seconds(time);
  const line = $('raster-playhead');
  if (line) { line.setAttribute('x1', 45 + fraction * 675); line.setAttribute('x2', 45 + fraction * 675); }
  document.querySelectorAll('.event-marker').forEach((marker) => { marker.style.opacity = Number(marker.dataset.start) <= time ? '1' : '.12'; });
}
function run() {
  stopPlayback();
  results = compare(scenario);
  selectedClient = Math.min(selectedClient, scenario.clients - 1);
  $('playhead').value = 1000;
  renderComparison(); renderRaster(); renderTable();
}
function applyScenario(input, presetId = '', resetRanges = true) {
  const next = validateScenario(input);
  scenario = next;
  activePreset = presetId;
  syncControls(resetRanges); run();
}
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('scenario-form').addEventListener('submit', (event) => event.preventDefault());
$('scenario-form').addEventListener('input', (event) => {
  const input = event.target;
  if (!Object.hasOwn(scenario, input.id)) return;
  if (input.type === 'number' && input.value === '') return;
  const next = { ...scenario, [input.id]: input.type === 'checkbox' ? input.checked : Number(input.value) };
  if (input.id === 'baseDelayMs' && next.baseDelayMs > next.maxDelayMs) next.maxDelayMs = next.baseDelayMs;
  if (input.id === 'maxDelayMs' && next.maxDelayMs < next.baseDelayMs) next.baseDelayMs = next.maxDelayMs;
  try { applyScenario(next, '', false); $('notice').hidden = true; }
  catch (error) { notice(error.message, true); }
});
$('scenario-form').addEventListener('change', () => syncControls());
$('presets').addEventListener('click', (event) => {
  const button = event.target.closest('[data-preset]');
  if (button) { const preset = PRESETS.find((item) => item.id === button.dataset.preset); applyScenario(preset.scenario, preset.id); }
});
$('reset').onclick = () => { applyScenario(DEFAULT_SCENARIO, PRESETS[0].id); history.replaceState(null, '', location.pathname + location.search); notice('Default experiment restored.'); };
for (const id of ['baseline', 'candidate']) $(id).onchange = () => { renderComparison(); renderTable(); };
$('timeline-policy').onchange = () => { stopPlayback(); $('playhead').value = 1000; renderRaster(); };
$('raster').addEventListener('click', (event) => { const row = event.target.closest('[data-client]'); if (row) { selectedClient = Number(row.dataset.client); renderRaster(); } });
$('raster').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('[data-client]');
  if (row) { event.preventDefault(); selectedClient = Number(row.dataset.client); renderRaster(); document.querySelector(`[data-client="${selectedClient}"]`)?.focus(); }
});
$('play').onclick = () => {
  if (playing) { stopPlayback(); return; }
  playing = true;
  $('play').innerHTML = 'Ⅱ <span>Pause</span>';
  $('play').setAttribute('aria-label', 'Pause simulation replay');
  const start = performance.now();
  const tick = (now) => {
    $('playhead').value = Math.min(1000, Math.floor((now - start) / 8));
    updatePlayback();
    if (Number($('playhead').value) >= 1000) stopPlayback();
    else playFrame = requestAnimationFrame(tick);
  };
  playFrame = requestAnimationFrame(tick);
};
$('playhead').oninput = () => { stopPlayback(); updatePlayback(); };
$('import-button').onclick = () => $('import-file').click();
$('import-file').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 65536) throw new Error('Scenario files must be at most 64 KiB.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    applyScenario(JSON.parse(text));
    notice(`Imported ${file.name}. All five policies use this scenario.`);
  } catch (error) { notice(`Import failed: ${error.message}`, true); }
  event.target.value = '';
};
$('export-scenario').onclick = () => { download('backoff-scenario.json', JSON.stringify(scenario, null, 2) + '\n', 'application/json'); notice('Scenario JSON exported.'); };
$('export-csv').onclick = () => { download('backoff-attempts.csv', attemptsCSV(results), 'text/csv;charset=utf-8'); notice('Attempt CSV exported for all five policies. Client IDs start at 1.'); };
$('export-report').onclick = () => { download('backoff-report.html', reportHTML(scenario, results), 'text/html;charset=utf-8'); notice('Self-contained HTML report exported. Open it in any browser.'); };
$('share').onclick = async () => {
  const url = new URL(location.href);
  url.hash = `s=${encodeScenario(scenario)}`;
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url.href); notice('Experiment link copied. The link contains scenario parameters; recipients need access to this host.'); }
  catch { notice('Clipboard unavailable. The experiment link is now in your address bar; copy it there.'); }
};
function restoreHash() {
  if (!location.hash.startsWith('#s=')) return;
  try { applyScenario(decodeScenario(location.hash.slice(3))); notice('Shared experiment loaded.'); }
  catch (error) { notice(error.message, true); }
}
window.addEventListener('hashchange', restoreHash);
drawControls();
run();
restoreHash();
