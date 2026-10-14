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
