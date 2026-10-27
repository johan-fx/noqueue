# Recover D1 through an evidence-first procedure

**Status (2026-10-17):** Native Time Travel and the new FTS5-compatible encrypted
logical backup have both passed disposable EU D1 restore rehearsals. The native
full SQL export still cannot handle FTS5; the new tool avoids that exporter and
never deletes or changes production's search index. Scheduling, off-device
custody and a retention/access policy are separate operational follow-ups.

## Local recovery

1. Stop Wrangler.
2. Preserve `.wrangler/state` as incident evidence when debugging matters.
3. Reset only the local D1 state.
4. Run `pnpm --filter @noqueue/api db:migrate:local`.
5. Start the stack and verify `/api/v1/health` plus affected behavior.

## Remote incident

Do not mutate production first. Record the database, time window, deployment version and suspected writes. Use Cloudflare's currently documented D1 backup/time-travel mechanism for the approved environment, restore into a safe target when possible, validate application invariants, then execute the recovery approved by the incident owner.

## Proven initial-release rehearsal

The disposable `noqueue-production-recovery-check-20261017` database contained
only a synthetic probe. After recording a bookmark, the probe was changed;
restoring that bookmark recovered its original value. The disposable database
was then deleted. No production data was restored, reset or copied into staging.

Actual production database: `aee70f5d-5c30-47ec-bf97-e24bcd3620e8`.
Pre-first-deploy bookmark (2026-10-17):
`00000004-00000000-00005107-741874ef9eff20e03259a92af01fc06b`.
Bookmarks have provider-limited retention; this is evidence, not a permanent
backup. Verify the current available window before any incident recovery.

`wrangler d1 export --remote` returned
`cannot export databases with virtual tables (like FTS5)` for this schema's
`service_search` index. No SQL backup was produced. Do not remove the active
index or its triggers to make export work. The logical backup below preserves
base tables and recreates the derived index without that destructive workaround.

Production security keys are separately required to decrypt restored contact
data. Transfer them to secure client custody; D1 Time Travel alone does not back
up Worker secrets, R2 logo objects or queue state. Coordinate any restoration
with message idempotency/unknown outcomes; never replay outbox rows blindly.

## FTS5-compatible logical backup

`scripts/production/backup-production.mjs` reads the configured production DB.
After schema/column introspection, **one SELECT** captures the base-table data,
schema and sequences in the same read snapshot. It rechecks schema consistency
and fails closed on unsupported changes. No paging of a changing live database
is misrepresented as a consistent backup.

The SQL values remain SQLite-generated literals, avoiding JavaScript int64
precision loss. Text is hex encoded (including embedded NUL), blobs/nulls and
rowids are preserved. FTS shadow tables are excluded; `service_search` is rebuilt
from `queue` and `venue`. Unique indexes are created before inserting data because
composite foreign keys require them. Triggers are installed **after** loading
data so restoration does not create duplicate notifications/audit/metrics events.

Archives use AES-256-GCM with a fresh nonce and an independent 256-bit key. The
tool verifies encryption/decryption and local SQLite integrity/FKs before writing
a successful report. Files are 0600 in a 0700 directory; no plaintext dump is
written and no values are placed in arguments or diagnostics. The default folder
is gitignored `reports/production-private/backups`. The key file is
`backup-key.hex`: transfer it to a separate secure vault; storing key and archive
together on this machine is **not** an off-device disaster-recovery policy.

With the explicitly authorized account and API token supplied securely in the
environment (never a literal token in shell history):

```sh
# Read production, create a new encrypted archive, and optionally rehearse it.
pnpm production:backup --confirm-production-read --rehearse

# Rehearse an existing archive WITHOUT reading production (works if it is down).
pnpm production:backup --archive /ABSOLUTE/PRIVATE/production-TIMESTAMP.json.aes256gcm \
  --key-file /ABSOLUTE/PRIVATE/backup-key.hex --rehearse
```

`--rehearse` creates a fresh EU D1 with a unique `noqueue-backup-check-*` name,
no routes, Worker binding, consumer or cron. It verifies identity/emptiness before
loading the authenticated archive, then compares all base-table values, schema
and sequences. It runs `foreign_key_check` and D1's supported `quick_check`
(`integrity_check` is used locally, not remotely). Synthetic FTS insert, MATCH,
venue/queue rename and delete probes run only in the disposable database.
The tool deletes only that invocation's verified UUID/name in `finally`.
Reports record failures and cleanup; an unknown create outcome is not blindly
retried. Production and staging are never restore targets of this CLI.

### Verified evidence and limits

- Saved production archive: `production-2026-10-17T10-49-02-795Z.json.aes256gcm`.
- 66 base tables, exact data/schema/sequence comparison, local integrity/FKs,
  remote quick-check/FKs and all FTS probes passed. Disposable database
  `b2e81fbf-5df9-4b5c-b353-974354584715` was deleted.
- A second rehearsal read that saved archive without querying production at all
  (`sourceRead=false`), passed the same comparisons/probes, and deleted its
  disposable database `f8ca777d-13f3-435a-81e8-2f9f14b98481`. Its report is
  `production-2026-10-17T10-50-59-400Z.report.json` in the private backup folder.
- Reports and encrypted archives live in the private folder, not Git. Sanitized
  summaries: `queue-reports/production/backup-verification.log` and
  `backup-archive-restore.log`. Failed diagnostic attempts are clearly distinct
  from successful reports; their disposable databases were also deleted.
- This is a **bounded first-release tool**, not an unlimited or periodic backup
  service: maximum serialized snapshot 1 MiB, generated snapshot query and restore
  SQL 95 kB each. It aborts without claiming success when limits are exceeded;
  never split the live snapshot into inconsistent pages to get around a failure.
  Extend and rehearse the strategy before growth reaches these limits.
- D1 limits compound SELECT terms to 50 and can flatten nested UNION groups.
  Grouped JSON subqueries avoid that mismatch with local SQLite.
- No scheduled backup, remote archive storage, email alert or retention deletion
  was enabled. Agree those separately; keep the independent key safe.

A real incident restore, application binding switch, R2 recovery or message-state
reconciliation still needs a reviewed incident procedure and explicit approval.
This tool intentionally does not offer an arbitrary live restore target.

### Explicit local-only backup (2026-10-27)

A live snapshot can fit the 1 MiB archive bound while its restoration SQL exceeds
D1 tooling's 95 kB single-request bound. The default and `--rehearse` still fail
closed above 95 kB; that remote limit has **not** been relaxed or split into
non-atomic requests.

For an explicitly authorized production read with **no remote rehearsal**, use:

```sh
pnpm production:backup --confirm-production-read --local-only
# Independently restore the saved archive in memory; no Cloudflare credentials/network needed:
pnpm production:backup --archive /ABSOLUTE/PRIVATE/production-TIMESTAMP.json.aes256gcm \
  --key-file /ABSOLUTE/PRIVATE/backup-key.hex --local-only
```

`--local-only` is incompatible with `--rehearse`. It keeps the 1 MiB snapshot
bound and permits at most 1 MiB of restoration SQL, only for an in-memory SQLite
restore. It verifies the archive read back from disk, compares every table/value,
schema object and sequence, checks integrity/FKs, rebuilds FTS and runs local
insert/update/delete/MATCH probes. No plaintext dump or local database is saved,
no application/cron/provider is started, and no migrations are applied.

The report distinguishes `localVerification`, `restoreSqlBytes` and
`remoteSingleRequestSupported`. A passing local report with the latter `false`
is **not evidence of a successful D1 remote restoration**: extend and validate
remote recovery tooling separately before relying on this archive for a live
cutover. Worker secrets, R2 and queue state still require separate custody.
