#!/usr/bin/env node

import { lstat, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_SCENARIO,
  POLICIES,
  compare,
  validateScenario,
} from '../src/simulator.js';

const MAX_SCENARIO_BYTES = 64 * 1024;

const help = `Backoff Lab — a deterministic retry simulator

Usage: backoff-lab [options]
       node bin/backoff-lab.js [options]

Options:
  --scenario <path>  Load a UTF-8 JSON scenario (maximum 64 KiB)
  --policy <id>      Compare one policy; repeat to select several
  --format <format> Output table (default) or json
  --output <path>   Write the result to a file instead of stdout
  --events          Include event, client, and bin data in JSON
  --help, -h        Show this help

Policy IDs: ${POLICIES.map((policy) => policy.id).join(', ')}

With no options, compares every policy using the default scenario.
JSON output includes schemaVersion, scenario, and per-policy metrics.
`;

function parseArgs(args) {
  const options = { format: 'table', policies: [] };
  const valued = new Map([
    ['--scenario', 'scenarioPath'],
    ['--policy', 'policy'],
    ['--format', 'format'],
    ['--output', 'outputPath'],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--events') {
      options.events = true;
      continue;
    }
    const key = valued.get(argument);
    if (!key) throw new Error(`Unknown option: ${argument}. Use --help for usage.`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
    if (key === 'policy') options.policies.push(value);
    else options[key] = value;
  }
  if (!['table', 'json'].includes(options.format)) {
    throw new Error('The --format option must be table or json.');
  }
  const available = new Set(POLICIES.map((policy) => policy.id));
  for (const policy of options.policies) {
    if (!available.has(policy)) throw new Error(`Unknown policy: ${policy}. Use --help for policy IDs.`);
  }
  options.policies = [...new Set(options.policies)];
  return options;
}

async function readScenario(filePath) {
  // Nonblocking open lets us reject FIFOs without waiting for a writer.
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error('The scenario path must be a regular file.');
    if (stats.size > MAX_SCENARIO_BYTES) throw new Error('The scenario file exceeds 64 KiB.');
    // Bound the actual read as well: a file could grow after stat().
    const buffer = Buffer.alloc(MAX_SCENARIO_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_SCENARIO_BYTES) throw new Error('The scenario file exceeds 64 KiB.');
    let source;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
    } catch {
      throw new Error('The scenario file must contain valid UTF-8.');
    }
    let input;
    try {
      input = JSON.parse(source);
    } catch {
      throw new Error('The scenario file must contain valid JSON.');
    }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('A scenario must be a JSON object.');
    }
    return input;
  } finally {
    await handle.close();
  }
}

function formatNumber(value, decimals = 0) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '—';
}

function renderTable(results) {
  const columns = ['Policy', 'Success', 'Attempts', 'Retries', 'P95 (ms)', 'Load ×', 'Peak retries'];
  const rows = results.map(({ policyId, metrics }) => [
    POLICIES.find((policy) => policy.id === policyId)?.name ?? policyId,
    String(metrics.successCount),
    String(metrics.attempts),
    String(metrics.retries),
    formatNumber(metrics.p95Ms),
    formatNumber(metrics.amplification, 2),
    String(metrics.peakRetryBin),
  ]);
  const widths = columns.map((column, index) => Math.max(column.length, ...rows.map((row) => row[index].length)));
  const line = (row) => row.map((cell, index) => index ? cell.padStart(widths[index]) : cell.padEnd(widths[index])).join('  ');
  return `${line(columns)}\n${widths.map((width) => '─'.repeat(width)).join('  ')}\n${rows.map(line).join('\n')}\n`;
}

async function writeOutput(filePath, output) {
  const destination = path.resolve(filePath);
  try {
    const existing = await lstat(destination);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error('The output path must be a regular file, not a directory or symbolic link.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const staging = await mkdtemp(path.join(path.dirname(destination), '.backoff-output-'));
  try {
    const stagedFile = path.join(staging, 'report');
    await writeFile(stagedFile, output, { encoding: 'utf8', flag: 'wx' });
    await rename(stagedFile, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(help);
    return;
  }
  const input = options.scenarioPath ? await readScenario(options.scenarioPath) : structuredClone(DEFAULT_SCENARIO);
  const scenario = validateScenario(input) ?? input;
  const results = compare(scenario, options.policies.length ? options.policies : undefined);
  const resultData = options.events ? results : results.map(({ policyId, metrics }) => ({ policyId, metrics }));
  const output = options.format === 'json'
    ? `${JSON.stringify({ schemaVersion: 1, scenario, results: resultData }, null, 2)}\n`
    : renderTable(results);
  if (options.outputPath) await writeOutput(options.outputPath, output);
  else process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`backoff-lab: ${error.message}\n`);
    process.exitCode = 1;
  });
}
