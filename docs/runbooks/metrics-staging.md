# Staging metrics: activation and scheduler recovery

## Isolation and rollout gate

Target only `noqueue-api-staging` and D1 `noqueue-staging`. Never run these steps
against production or sandbox. Apply `0027_admin_metrics.sql` before capture.
Keep `METRICS_DASHBOARD_ENABLED=false` until a real scheduled cut has completed.
Reconcile release configuration with live non-secret vars and secret names before
using Wrangler: a blank checked-in provider phone ID must not overwrite the live
staging value. Do not copy secrets into Git or the release config.

## Undelivered trigger (14 October 2026)

The dedicated `*/15 * * * *` trigger was registered at 17:19 UTC. Through 19:01 UTC,
no analytical invocation, backfill, or cut was observed. Unfiltered scheduled tails
showed the existing minute trigger successfully running the correct deployed
version. Reapplying schedules and deleting/recreating only the analytical trigger
at 18:46 UTC did not restore delivery in the observed window. The handler itself
passes integration tests with D1 and backfill.

This establishes a scheduler-delivery failure, not its internal Cloudflare cause.
Cloudflare published a similar [activation incident](https://www.cloudflarestatus.com/incidents/cbvocc87nsne),
but marked it resolved before this deployment; it is not proof that this release
was affected by that incident.

## Staging-only recovery

`METRICS_CRON_RECOVERY_ENABLED=true` is effective only with `APP_ENV=staging`.
Staging retains its existing `* * * * *` trigger. Analytics runs **after** queue
maintenance, notification reconciliation, quota cleanup and logo maintenance.
No HTTP maintenance endpoint or additional access capability is introduced.

- A missing/stale cut runs on the next minute tick; steady-state cadence is 15 min.
- An incomplete cut or historical import resumes each minute until complete.
- A final cut must pass the last backfill completion time (cuts lag by 30 seconds).
- The processor gets at most 256 D1 statements, or a lower configured limit;
  its deadline, existing lease/fence and coordinator serialization remain intact.
- Analytical errors log `metrics_cron_recovery_failed`, leave progress unchanged
  and do not fail already completed operational work. The next tick retries.
- Late dedicated-trigger deliveries are ignored while staging recovery is enabled.
- All other environments retain the dedicated trigger and previous behavior.

Inspect scheduled tails for `metrics_cron_recovery_started` and `metrics_cut`.
Success requires persisted progress, not just an `ok` invocation:

```sql
SELECT cursor,last_complete_at,target_seq,target_at FROM metrics_control;
SELECT COUNT(*) started,SUM(completed_at IS NOT NULL) completed FROM metrics_backfill;
SELECT COUNT(*) daily_rows,SUM(generated) generated FROM metrics_daily;
```

Verify all eligible queues have completed backfill and `target_at IS NULL` before
assessing historical totals. Historical/occupancy coverage may correctly remain
partial: importing old entries cannot reconstruct unobserved historical occupancy.

## Dashboard and permission smoke

After the real cut, enable `METRICS_DASHBOARD_ENABLED=true` using reconciled staging
configuration. With authorized disposable users, verify owner/venue_manager reads,
viewer/queue_staff denial, another venue's 404, strict query scope rejection,
revoked membership and banned account denial, and admin/commercial mixed-role
portfolio tabs without duplicate venue tabs. Reconcile venue totals with scoped
D1 rollups. Do not create queue entries, call turns, or send messages for this smoke.
Delete disposable users/assignments/sessions afterwards; retain audit records.

To disable the dashboard, turn off only its flag; capture can continue. To return
to dedicated scheduling, first verify delivery of that trigger in staging, then
restore its cron and disable the recovery flag together. Never remove the minute
trigger: it is also the operational recovery path.

## Verification of the recovery release

On 14 October 2026 the recovery code (`4c3b953`) produced real scheduled cuts.
The activation gate passed at 19:17 UTC: all 15 eligible queues imported,
79 eligible entries reflected in rollups, no open cut, and the published cut
newer than the final backfill. The dashboard was then enabled in staging version
`52a7a15a-450d-4c66-9df7-ae13ae95e14b` (capture and recovery also enabled).

- API: 638 local tests pass with capture on and off; web: 571 tests pass.
- Real sessions: 33 API assertions cover permissions, isolation, query overrides,
  revocation, banned users and mixed roles; own-venue totals reconcile with D1.
- Browser: owner/manager get Gestión/Métricas, viewer/assigned queue_staff do not;
  a 403 refresh removes an already displayed snapshot. All four combinations of
  admin/commercial with owner/manager retain only Establecimientos/Métricas and
  preserve existing venue management.
- The temporary account, its memberships, assignments and sessions were deleted.
  The dedicated admin smoke session was signed out; audit records were retained.
- Operational baseline unchanged: 97 queue entries, version sum 130 and identical
  notification status counts, with no pending/sending messages. The analytics
  total excludes the separate confirmation experiment. Production was not changed.

An old open PWA may keep serving its previous bundle while other tabs prevent a
safe update. Preserve unsaved work in those tabs. For this verification only the
agent-owned test tab was hard-reloaded, and its module URL was checked against
the deployed release; other user tabs were not closed or changed.

## Historical service classification (15 October 2026)

The admission `service_window_id` contains a JSON signature with the service type
at admission. The current queue configuration is NOT historical evidence: its
type is mutable and configuration audit rows do not retain before/after values.

`METRICS_SERVICE_SNAPSHOT_CAPTURE_SINCE` is an explicit, environment-specific,
verified admission-capture boundary. Staging uses `2026-10-11T00:00:00Z`, after
the snapshot implementation was deployed (migration 0014 applied 10 October).
Other environments remain unset. Without a boundary, for earlier admissions,
invalid signatures/zones/dates, or legacy/synthetic snapshots, backfill continues
to use `unknown`. Legacy maintenance can populate previously NULL snapshots;
therefore simply finding a JSON signature in an older entry is NOT sufficient.
Recovery changes only the service type, not the historical/coverage designation,
timezone, wait evidence or operational data. Existing live identities win.

Existing analytical dimensions require a separate, audited repair; rerunning
backfill alone is insufficient. The operator script is hard-wired to the staging
D1 ID and uses Wrangler's remote D1 binding, with no public maintenance endpoint.
Create a reviewed manifest `{ venueId, entryIds, capturedSince }` (maximum 100
explicit IDs) and retain a scoped analytical backup plus before/after totals.

```sh
# From apps/api; first invocation is read-only.
node scripts/reclassify-historical-metrics.mjs /absolute/manifest.json
node scripts/reclassify-historical-metrics.mjs /absolute/manifest.json --apply
```

The single D1 batch is guarded against an active lease/cut, unprocessed events,
changed entries, partial source dimensions, missing retained detail and nonzero
historical occupancy. It migrates identities, retained events, entry dimensions,
daily/hourly counts and dirty markers together; a failure rolls everything back.
It preserves destination occupancy coverage rather than adding duplicate empty
observation intervals. Repeating the identical manifest is a no-op. A changed
cohort must be reviewed again; never bypass the guards or reclassify by queue name.

The approved SOL LUNAMAR PALMANOVA cohort is 55: Front Desk 18 reception;
Snack bar 31 restaurant; QA1012 Contextual 5 restaurant; QA1012 Avisos 1 restaurant.
Keep all six QA turns. Expected totals: 55 generated, 11 completed, 38 cancelled,
6 no-shows (`expired`), 0 pending; 23 wait samples totaling 6,407,131 ms.
Verify these totals, all other venues, operational versions/notification counts,
and another completed analytical cut after repair. No production rollout is implied.

Recovery was deployed only to staging as version
`a178a6e3-0ce6-4f16-8b3e-5d7cd2bd37f2`. The transaction changed 55 entries and an
identical retry changed zero. Chrome confirmed 18 reception / 37 restaurant and
no unknown row. Daily/hourly totals for every venue, operational entry/version
counts, notification counts and existing Worker bindings matched the preflight.
Validation: 647 API tests with capture disabled and enabled, 571 web tests, and
type checking pass. Nine new cases cover snapshot validation, admission cutoff,
QA preservation, isolation, atomic rollback, cut/capture fencing, idempotency,
subsequent updates and merges into an existing classified dimension. An existing
deadline test now compares rows rather than nondeterministic D1 timing metadata.
The next automatic cut completed at `2026-10-15T13:04:13.766Z` with cursor 79 and
no open target; all classification, totals and isolation assertions still passed.
