import { env } from 'cloudflare:workers'
import { applyD1Migrations } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('backfills all current queues for active/revoked staff only, with tenant integrity and no future auto-grants', async () => {
  const db = (env as typeof env & { AUTH_ISOLATION_DB: D1Database })
    .AUTH_ISOLATION_DB
  const before = env.TEST_MIGRATIONS.filter(
    (migration) => !migration.name.includes('0026_'),
  )
  await applyD1Migrations(db, before)
  await db.batch([
    db.prepare("INSERT INTO organization(id,name) VALUES ('scope-org','Test')"),
    db.prepare(
      "INSERT INTO venue(id,organization_id,name) VALUES ('scope-v1','scope-org','One'),('scope-v2','scope-org','Two'),('scope-empty','scope-org','Empty')",
    ),
    ...[
      'active',
      'revoked',
      'viewer',
      'manager',
      'owner',
      'other',
      'empty',
    ].map((id) =>
      db
        .prepare(
          "INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,'now','now')",
        )
        .bind(id, id, `${id}@example.test`),
    ),
    db.prepare(
      "INSERT INTO venue_membership VALUES ('active','scope-v1','queue_staff',1),('revoked','scope-v1','queue_staff',0),('viewer','scope-v1','viewer',1),('manager','scope-v1','venue_manager',1),('owner','scope-v1','owner',1),('other','scope-v2','queue_staff',1),('empty','scope-empty','queue_staff',1)",
    ),
    db.prepare(
      "INSERT INTO queue(id,venue_id,capacity,average_minutes,open) VALUES ('scope-open','scope-v1',10,5,1),('scope-closed','scope-v1',10,5,0),('scope-other','scope-v2',10,5,0)",
    ),
  ])
  await applyD1Migrations(db, env.TEST_MIGRATIONS)
  const grants = await db
    .prepare(
      'SELECT user_id,queue_id FROM staff_queue_assignment ORDER BY user_id,queue_id',
    )
    .all()
  expect(grants.results).toEqual([
    { user_id: 'active', queue_id: 'scope-closed' },
    { user_id: 'active', queue_id: 'scope-open' },
    { user_id: 'other', queue_id: 'scope-other' },
    { user_id: 'revoked', queue_id: 'scope-closed' },
    { user_id: 'revoked', queue_id: 'scope-open' },
  ])
  expect(
    await db
      .prepare("SELECT active FROM venue_membership WHERE user_id='revoked'")
      .first(),
  ).toEqual({ active: 0 })
  await db
    .prepare(
      "INSERT INTO queue(id,venue_id,capacity,average_minutes) VALUES ('scope-future','scope-v1',10,5)",
    )
    .run()
  await applyD1Migrations(db, env.TEST_MIGRATIONS)
  expect(
    (await db.prepare('SELECT * FROM staff_queue_assignment').all()).results,
  ).toHaveLength(5)
  await expect(
    db
      .prepare(
        "INSERT INTO staff_queue_assignment VALUES ('active','scope-v1','scope-other')",
      )
      .run(),
  ).rejects.toThrow()
  await expect(
    db
      .prepare(
        "INSERT INTO staff_queue_assignment VALUES ('active','scope-v1','scope-open')",
      )
      .run(),
  ).rejects.toThrow()
  await db.prepare("DELETE FROM queue WHERE id='scope-closed'").run()
  expect(
    (
      await db
        .prepare(
          "SELECT * FROM staff_queue_assignment WHERE queue_id='scope-closed'",
        )
        .all()
    ).results,
  ).toHaveLength(0)
})
