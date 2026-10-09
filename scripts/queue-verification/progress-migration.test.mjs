import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

test('progress migration backfills forecast duration, then original call grace, never legacy ETA', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`
      CREATE TABLE queue_entry(id TEXT PRIMARY KEY,status TEXT,called_at INTEGER,arrival_deadline_at INTEGER);
      CREATE TABLE queue_forecast_anchor(entry_id TEXT,predicted_at INTEGER,created_at INTEGER,legacy_eta_minutes INTEGER);
      INSERT INTO queue_entry VALUES
        ('parallel','waiting',NULL,NULL),('called','called',1000,301000),
        ('zero','waiting',NULL,NULL),('legacy','called',NULL,NULL),('negative','called',301000,1000);
      INSERT INTO queue_forecast_anchor VALUES
        ('parallel',1831000,1000,120),('called',1000,1000,999),('zero',1000,1000,999);
    `)
    db.exec(
      readFileSync(
        'apps/api/migrations/0017_customer_progress_baseline.sql',
        'utf8',
      ),
    )
    assert.deepEqual(
      Object.fromEntries(
        db
          .prepare(
            'SELECT id,progress_initial_eta_minutes AS initial FROM queue_entry',
          )
          .all()
          .map((row) => [row.id, row.initial]),
      ),
      { parallel: 31, called: 5, zero: null, legacy: null, negative: null },
    )
    for (const invalid of [0, -1])
      assert.throws(
        () =>
          db
            .prepare(
              "UPDATE queue_entry SET progress_initial_eta_minutes=? WHERE id='zero'",
            )
            .run(invalid),
        /CHECK constraint failed/,
      )
    assert.equal(
      db
        .prepare(
          "SELECT legacy_eta_minutes AS eta FROM queue_forecast_anchor WHERE entry_id='parallel'",
        )
        .get().eta,
      120,
    )
  } finally {
    db.close()
  }
})
