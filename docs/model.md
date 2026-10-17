# The Backoff Lab model

Backoff Lab runs a deterministic discrete-event simulation of a finite cohort of clients. Each client wants one successful response. All policies see the same scenario and initial arrival times. The engine uses integer milliseconds and advances directly between events; it sends no HTTP requests and does not wait in real time.

The source of truth is [`src/simulator.js`](../src/simulator.js).

## A request's lifecycle

1. A client arrives once, at an integer time chosen uniformly from `0` through `spreadMs`, inclusive. With `spreadMs: 0`, every client arrives at time zero.
2. An attempt starting before `outageMs` fails with outcome `outage`.
3. Otherwise, if all `capacity` slots are occupied, it fails with outcome `overload`. There is no queue.
4. Otherwise, the server accepts the attempt and holds a slot for `latencyMs`.
5. A failed attempt responds after `failureLatencyMs`. Failures consume no server slots.
6. After an observed failure, a client either exhausts its attempt budget or waits according to its policy and retries.
7. A successful response, exhausted budget, or expired deadline ends the client's work.

The outage is one interval, `[0, outageMs)`, beginning at the simulation origin. An attempt starting exactly at `outageMs` can be accepted. Capacity means **concurrent accepted requests**, not requests per second. Increasing service time keeps slots occupied longer without changing their count.

`maxAttempts` includes the first attempt. Backoff begins after the failure response arrives, not at the failed request's start time. Thus a fixed retry cycle includes both failure latency and the fixed wait.

## Deadlines and server work

Each client's deadline is `startedAtMs + deadlineMs`. It is a budget for the entire operation, including all requests and waits, rather than a separate timeout per attempt.

If an attempt's response would arrive after the deadline, its observed outcome is `deadline` and its recorded `endMs` is the deadline. A response arriving exactly at the deadline is observed normally. If another attempt would start at or after the deadline, that attempt is never sent; the client expires at its deadline instead.

An accepted request that exceeds the client's deadline **continues occupying its server slot until its actual service completion**. The simulation models the client stopping its wait, not the server canceling its work. No further attempt is sent by that client after its deadline.

Terminal client states are:

| State | Meaning |
| --- | --- |
| `success` | A successful response arrived within the client's deadline. |
| `exhausted` | The last allowed attempt returned an observed failure. |
| `deadline` | The operation's deadline expired during a request or before the next retry. |

`completedAtMs` is populated only for successful clients. It is `null` for the other terminal states.

## Backoff policies

Let `n = failedAttempt - 1`, so the first failed attempt uses `n = 0`. Let `base = baseDelayMs`, `cap = maxDelayMs`, and `window = min(cap, base × 2ⁿ)`. `U(a, b)` draws an integer uniformly from the inclusive range `[a, b]`.

| Policy ID | Wait after a failure |
| --- | --- |
| `fixed` | `base` |
| `exponential` | `window` |
| `full` | `U(0, window)` |
| `equal` | `U(ceil(window / 2), window)` |
| `decorrelated` | `min(cap, U(base, previous × 3))` |

Decorrelated jitter starts with `previous = base` and stores each newly drawn policy delay for the next retry. The cap is applied **after** the draw, so values above the cap accumulate at the cap; this is different from drawing uniformly inside a capped range. Full jitter can choose zero milliseconds, but failure response time is always positive.

The policy names and formulas follow the terminology in [Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/), with integer-millisecond rounding made explicit here. The AWS article's optimistic concurrency control simulation has different service semantics; this model does not reproduce its graphs or numerical conclusions.

## Retry-After

With `respectRetryAfter: true`, the actual wait after every observed retryable failure is:

```text
actualWait = max(policyWait, retryAfterMs)
```

The hint applies to outage and overload responses. It is a fixed relative delay measured from the failed response, not an absolute recovery timestamp or a parsed HTTP header. It may exceed the exponential delay cap. For decorrelated jitter, `previous` retains the policy-generated delay before the hint is applied.

Applying the same minimum wait to every client can align their retries again. The tool lets that behavior emerge from the chosen scenario; it does not add extra jitter after the server hint.

## Reproducibility and event ordering

Each client has its own pseudorandom stream, seeded from the scenario seed and client ID. One initial draw is always reserved for that client's arrival, even when `spreadMs` is zero. Remaining draws provide jitter. More retries by one client therefore cannot change another client's arrival or random stream.

For the same engine implementation, scenario, and policy, every run returns the same result. Different policies consume their streams differently, so a shared seed aligns arrivals and makes experiments reproducible; it does not make every random delay identical across policies. To study variability, repeat with multiple seeds rather than generalizing from one result.

Events at the same time are ordered as follows:

1. Server-slot releases.
2. Responses observed by clients.
3. New attempt starts.

Within one priority, insertion order breaks ties. Initial arrivals are inserted in client-ID order. A slot released at time `t` is available to a request starting at time `t`. These deterministic tie rules can favor earlier clients in synchronized bursts; there is no randomized server scheduling or fairness model.

## Scenario schema

Inputs are plain objects. Missing fields take the defaults below; unknown fields are rejected. Every numeric parameter must be a safe integer. `maxDelayMs` must be at least `baseDelayMs`.

| Field | Default | Accepted range / type | Meaning |
| --- | ---: | --- | --- |
| `version` | `1` | Exactly `1` | Scenario schema version |
| `clients` | `120` | 1–500 | Number of clients in the finite cohort |
| `outageMs` | `1500` | 0–120000 | Service outage from simulation time zero |
| `capacity` | `12` | 1–500 | Concurrent accepted-request slots |
| `latencyMs` | `180` | 1–30000 | Fixed service duration of an accepted request |
| `failureLatencyMs` | `60` | 1–30000 | Fixed delay before an outage/overload response |
| `baseDelayMs` | `180` | 1–60000 | Base policy delay |
| `maxDelayMs` | `4000` | 1–120000 | Exponential/decorrelated policy cap |
| `maxAttempts` | `10` | 1–20 | Attempt budget, including the initial request |
| `deadlineMs` | `15000` | 100–120000 | Total operation budget from each client's arrival |
| `spreadMs` | `0` | 0–120000 | Inclusive window for initial arrivals |
| `seed` | `42` | 0–4294967295 | Unsigned 32-bit random seed |
| `retryAfterMs` | `0` | 0–120000 | Minimum wait when the hint is enabled |
| `respectRetryAfter` | `false` | Boolean | Whether to apply the server hint |

Example partial scenario:

```json
{
  "version": 1,
  "clients": 120,
  "outageMs": 1500,
  "capacity": 12,
  "seed": 42
}
```

## Metrics

| Metric | Definition |
| --- | --- |
| `attempts` | Every attempt actually started, including each client's first request. |
| `retries` | `attempts - clients`. Unsent retries beyond a deadline are not counted. |
| `successCount` | Clients with a successful response by their deadline. |
| `exhaustedCount` | Clients that used all attempts and observed a final failure. |
| `deadlineCount` | Clients whose operation deadline expired. |
| `p95Ms` | Nearest-rank 95th percentile of `completedAtMs - startedAtMs`, **among successful clients only**; `null` if none succeed. |
| `amplification` | `attempts / clients`. A value of `1` means one attempt per client. |
| `peakRetryBin` | Maximum retries starting in any fixed 100 ms bucket. Initial attempts are excluded. This is a bucket count, not a rate or rolling-window peak. |
| `durationMs` | Latest terminal client time, measured from simulation time zero. It does not include server work continuing after every client has finished waiting. |

Terminal counts sum to `clients`. Low p95 with low completion can indicate that only a small, fortunate subset succeeded; compare the two metrics together.

`bins` use fixed intervals `[100k, 100(k + 1))`. `initial` and `retry` count attempt starts. `success`, `outage`, and `overload` count observed responses. `deadline` counts terminal clients at their deadlines, including clients whose next retry was never sent. These counters refer to different event types and should not be added to obtain a request count.

## Attempt records

Each entry in `events` contains:

| Field | Meaning |
| --- | --- |
| `clientId` | Zero-based client ID |
| `attempt` | One-based attempt number |
| `startMs` | Absolute start time from simulation origin |
| `endMs` | Observed response time, clipped to the client's deadline |
| `outcome` | `success`, `outage`, `overload`, or `deadline` |
| `backoffMs` | Actual wait before this attempt; zero for the initial attempt |
| `nextStartMs` | Present only if a next attempt was scheduled |

Client records group their own events. `compare()` returns one complete result per policy. The CLI's JSON envelope has `schemaVersion: 1`, a normalized `scenario`, and `results`; without `--events`, each result includes only `policyId` and `metrics`.

## Browser exports

Scenario JSON and shared URLs carry normalized scenario parameters and the seed. They do not store the selected baseline/challenger, client selection, or playback position. Shared URLs encode the scenario as base64url JSON in the `#s=` fragment; the recipient must have access to the app's origin.

Attempt CSV includes all five policies and uses these columns: `policy`, `client_id`, `attempt`, `start_ms`, `end_ms`, `outcome`, `backoff_ms`, `next_start_ms`, `client_status`. CSV and the visual interface display **one-based client IDs**; engine and CLI JSON records use zero-based `clientId`. An unscheduled next attempt produces an empty `next_start_ms` cell.

The HTML report is a standalone static snapshot with all five policies' metrics, model notes, and the scenario JSON. It includes no external assets or scripts. To interact with the experiment again, import the included JSON into the app.

## Scope

This model intentionally exposes a small set of causes: synchronized arrivals, retry timing, finite concurrency, a recovery point, and client budgets. It does not model continuous traffic, queueing, variable network/service latency, multiple service hops, retryable HTTP status rules, idempotency, cancellation propagation, token-bucket limits, circuit breakers, or adaptive retry algorithms. Rejected requests have no modeled server cost beyond their response delay.

Use it to inspect mechanisms and construct reproducible examples. Validate decisions about an actual service against that service's behavior, retry semantics, and measurements.
