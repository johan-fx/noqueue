# Verify queue behavior, then inspect the evidence

Run `pnpm test:queue` for deterministic scheduling, real Worker/D1 commands and critical Chromium journeys. Open the printed `queue-reports/<run>/index.html`; it links expected/observed timelines, JSON and Playwright traces. Each invocation has an immutable output directory.

## Commands

| Command                                         | Coverage                                                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:queue`                               | 200 property examples; 20 sequences of 25 actual operations; critical Chromium flows plus existing opening/service journeys         |
| `pnpm test:queue:extended`                      | 2,000 property examples; 100 sequences of 100 actual operations; business journeys in Chromium, Firefox and WebKit                  |
| `node scripts/queue-verification/run.mjs --all` | Standard generated counts, all API tests and the entire existing browser suite; used by CI without duplicate API/browser executions |
| `pnpm test`                                     | Existing workspace unit tests, including the new standard-count API simulations                                                     |
| `pnpm test:e2e`                                 | Entire browser suite without the combined report                                                                                    |

Install browsers first with `pnpm --filter @noqueue/e2e exec playwright install chromium firefox webkit`. No external messaging provider or remote database is used. Extended verification is manual, not scheduled. A full extended run executes 10,000 real command operations and can take several minutes.

To replay a generated failure, copy the **Reproduce** command from its HTML scenario. The JSON `replay` object preserves profile, seed, shrink path, property count, sequence count and sequence length. Preserve the same checkout and installed fast-check version: a shrink path belongs to that exact generator configuration, not just its seed.

For an extended sequence failure, the equivalent command is:

```sh
QUEUE_PROPERTY_RUNS=2000 QUEUE_SEQUENCE_RUNS=100 QUEUE_SEQUENCE_LENGTH=100 \
QUEUE_SEED=<reported-seed> QUEUE_PATH='<reported-path>' \
pnpm --filter @noqueue/api exec vitest run src/features/queue/verification.test.ts -t Q-SEQUENCES
```

Standard runs use `200`, `20`, and `25` respectively. Using the default length 25 to replay a length-100 shrink path can fail with `Unable to replay, got wrong path`; it is not evidence that the original bug disappeared. For Q-PROPERTY, select `verification-engine.test.ts -t Q-PROPERTY` with the recorded configuration. A passing scenario's command repeats its seeded sample without a shrink path. Do not apply one test's shrink path to the entire suite.

The default seed is 20260929; change `QUEUE_SEED` to explore another reproducible sample. Sequences generate valid operations, not discarded preconditions: every step executes skip, cancel, service or no-show, checks FIFO/occupancy, and replays the command.

## Rule map and independent oracles

| Rule                              | Proof                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-PARALLEL                        | Two compatible resources, 50/20 minutes: `[0,0,20]`; replacing 20 by 35: `[0,0,35]`                                                                            |
| Q-LEARNING                        | Five-observation prior, 2/3 threshold, recency, rounding, invalid durations, last-30 window; constants are manually calculated                                 |
| Q-EXPIRY / Q-PREFERENCES          | Exact expiry instant, anchored countdown, strict space, fastest, FIFO and unknown/provisional quality                                                          |
| Q-PROPERTY                        | Homogeneous parallel resources checked against independent `floor(index/resourceCount)*duration`, without mutating inputs or duplicate callable resources      |
| Q-CLOCK                           | One internal timestamp for call, event, reservation, arrival, release, grace and replay; production requests cannot supply it                                  |
| Q-COMMAND-LEARNING / Q-BOUNDARIES | Real call→arrival→release commands; matching space/size only; 30/31 observations                                                                               |
| Q-SEQUENCES / Q-ANCHOR            | Separate FIFO model after every operation, idempotent replay, no-show grace, explicit release, stale versions, conflicting keys and immutable initial forecast |
| Q-PRODUCTION                      | Test history route returns 404 in the production app                                                                                                           |
| Q-BROWSER-*                       | Independent staff/customer contexts: reorder, physical capacity, close, changed mean and learned ETA displayed on both screens                                 |

Existing engine/projection/opening/staff/vertical tests remain part of the run: concurrency through the coordinator, service-specific admission, person capacity, inventory safety, policy persistence, availability adjustments and notification deduplication. Their report rows identify assertion outcomes; detailed numeric timelines are supplied by the new Q-* scenarios.

The CDP-based queue-services/queue-swipe specs and pre-existing Chromium-only real-experiment specs are explicitly scoped to Chromium; they are excluded from Firefox/WebKit collection rather than reported as passing skips. New Q-BROWSER business journeys and queue-opening run on all three engines in extended/CI profiles.

## Reading results safely

A missing required scenario, absent browser, absent evidence, failed command, skipped case or flaky result cannot produce a passing combined report. CI uploads reports even after failures and retains them for 14 days. `evidence.json` includes the Git revision and whether the checkout was dirty; it is evidence for the tested working tree, not a claim that HEAD alone was tested.

Browser traces can include synthetic account credentials and private synthetic turn links. Keep CI artifacts access-restricted; never publish them on a public website. Summaries contain scenario outcomes, not those links. A passing synthetic suite verifies implemented rules and propagation, not real-world ETA accuracy or actual WhatsApp delivery.

## Isolation and cleanup

Playwright chooses an unused loopback port unless `NOQUEUE_E2E_PORT` is explicitly supplied, refuses to reuse a running server, and gives every Worker launch a unique `apps/api/.wrangler/e2e-runs/run-*` persistence directory. Port allocation closes the reservation before Worker startup; a competing bind fails safely rather than attaching to another server. Never point the harness at a development database.

Local state is intentionally retained for diagnosis. After the associated Playwright process has stopped, remove only its printed `Isolated E2E state:` directory if no longer needed; never wipe the parent directory while another run may exist. Reports and state are ignored by Git. Test-only history injection accepts at most 31 valid durations for an existing group, requires loopback and a pilot token, and creates historical input records, not precomputed forecasts.

## Work units and rollback

1. Internal command clock plus its D1 regression; production callers retain the default clock.
2. Isolated browser harness, protected fixture and cross-browser journeys; remove together without changing deployed routes.
3. Deterministic oracle/generated suites and development dependency; retain existing suites.
4. Combined reporting, scripts and CI publication; rolling this back restores the previous CI test commands.

No business-rule redesign, schema migration, deployment or real provider send is included.
