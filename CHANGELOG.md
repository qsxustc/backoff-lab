# Changelog

## [1.0.0](https://github.com/qsxustc/backoff-lab/releases/tag/v1.0.0) — 2026-10-17

First stable release.

### Added

- A deterministic discrete-event simulator shared by the browser app and Node.js CLI.
- Five retry policies: fixed delay, exponential backoff, full jitter, equal jitter, and decorrelated jitter.
- Side-by-side request pressure charts, completion metrics, timeline replay, and per-client attempt inspection.
- Configurable outages, capacity, response times, backoff limits, attempt budgets, deadlines, initial arrivals, seeds, and Retry-After.
- Seeded scenario URLs and JSON import/export, attempt CSV downloads, and standalone HTML reports.
- CLI table and JSON output, with optional full event traces.
- A responsive interface, recorded README demo, English and Chinese documentation, and explicit model boundaries.
- Dependency-free local development and static builds, CI for Node.js 20/22/24, and GitHub Pages deployment.
- MIT license, contribution guide, reproducible examples, and 30 automated tests.
