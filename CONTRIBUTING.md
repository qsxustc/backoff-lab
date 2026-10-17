# Contributing to Backoff Lab

Backoff Lab helps people understand retry behavior through small, reproducible experiments. Contributions that make the model clearer, the results easier to inspect, or the app more accessible are welcome.

## Run the project

Use Node.js 20 or newer. No dependency installation is required.

```sh
npm run dev
npm test
npm run build
npm run preview -- --port 4174
```

The development server listens on `127.0.0.1:4173`. The preview command above serves `dist/` on a second port so both can run together.

## Before proposing a change

Read [docs/model.md](docs/model.md), especially the event ordering, deadline behavior, and metric definitions. A changed result is meaningful only when the model behind it is explicit.

Keep a change focused. A useful issue or pull request explains the observed behavior, the expected behavior, and the reason the change helps someone using the app. For simulation bugs, attach a small scenario JSON, policy ID, seed, and the relevant attempt trace. For UI bugs, include browser/version, steps to reproduce, and viewport size where relevant. Remove any unrelated personal information from attachments.

## Implementation guidance

- Keep simulation logic independent of the DOM, wall-clock timers, and network access. Browser and CLI results should agree.
- Preserve deterministic results for the same scenario, policy, and engine version. Document intentional changes to the model and update representative fixtures.
- Do not silently reinterpret existing scenario fields. Validate new fields and describe their units, limits, and defaults.
- Keep the runtime dependency-free. Discuss a new dependency before building around it.
- Use semantic controls, visible keyboard focus, text equivalents for charts, and layouts that work on narrow screens.
- Keep the English and Chinese READMEs aligned when behavior or setup changes.

Tests should check useful invariants and edge cases: capacity, completion, retry budgets, simultaneous events, deadlines, input validation, and reproducibility. Prefer small cases with explainable expected outcomes over snapshots that merely duplicate implementation output.

## Verify a contribution

Run `npm test` and `npm run build`. For UI changes, open the app and verify the changed interaction in both the source and built preview. Check keyboard operation and a narrow viewport when the change affects layout or controls. Export and re-import a scenario when touching serialization; verify CLI parity when touching the engine.

A pull request should state what users will observe, how it was checked, and any model or compatibility changes. Screenshots are helpful for visual changes. Avoid presenting one scenario's winner as a general performance claim.

## Useful directions

- Accessible ways to inspect dense timelines and compare clients.
- Small, well-explained scenarios that expose a surprising tradeoff.
- Additional export formats with a clear consumer or workflow.
- Multiple-seed comparisons that communicate variability rather than hiding it.
- New model features with explicit semantics and meaningful tests.

Queues, variable service times, token buckets, and continuous arrivals would change the model substantially. Discuss their semantics before implementation, and keep the simple burst experiment understandable.

By contributing, you agree that your contribution can be distributed under the repository's [MIT license](LICENSE).
