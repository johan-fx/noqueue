import { randomUUID } from 'node:crypto'

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const identifier = (value) => {
  if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(value)) throw new Error('Unsupported table name')
  return `"${value}"`
}
const derived = /^(?:sqlite_.*|_cf_.*|service_search(?:_(?:data|idx|content|docsize|config))?)$/

/** One INSERT and its trigger are atomic even when the SQL runner isn't a batch.
 * No remote request or credential generation occurs in this module. */
export function initialAdminStatements({ username, name, passwordHash, tables, id = randomUUID(), now = new Date().toISOString() }) {
  if (!/^[a-z0-9_.]{3,30}$/.test(username) || !name.trim() || name.length > 120 || !passwordHash)
    throw new Error('Invalid initial administrator')
  const trigger = `initial_admin_${id.replaceAll('-', '')}`
  identifier(trigger)
  const special = new Set(['d1_migrations', 'organization', 'venue', 'queue', 'user', 'metrics_control'])
  const empty = tables.filter((table) => !derived.test(table) && !special.has(table))
  for (const table of ['user', 'account', 'privacy_consent_receipt', 'metrics_control'])
    if (!tables.includes(table)) throw new Error('Apply all production migrations first')
  const assertions = [
    `(SELECT COUNT(*) FROM user)=1 AND EXISTS(SELECT 1 FROM user WHERE id=NEW.id AND role='platform_admin')`,
    `NOT EXISTS(SELECT 1 FROM organization WHERE id!='demo-org' OR name!='No Queue Demo')`,
    `NOT EXISTS(SELECT 1 FROM venue WHERE id!='demo-venue' OR organization_id!='demo-org' OR name!='Demo Restaurant' OR address_formatted IS NOT NULL)`,
    `NOT EXISTS(SELECT 1 FROM queue WHERE id NOT IN ('demo-queue','confirmation-experiment') OR venue_id!='demo-venue' OR config IS NOT NULL OR version!=0 OR name!='Cola' OR open!=1 OR average_minutes!=5 OR capacity!=CASE id WHEN 'demo-queue' THEN 20 ELSE 4 END)`,
    `NOT EXISTS(SELECT 1 FROM metrics_control WHERE cursor!=0 OR last_complete_at IS NOT NULL OR target_at IS NOT NULL)`,
    ...empty.map((table) => `NOT EXISTS(SELECT 1 FROM ${identifier(table)})`),
  ]
  return {
    create: `CREATE TRIGGER ${identifier(trigger)} AFTER INSERT ON user WHEN NEW.id=${quote(id)} BEGIN
      SELECT CASE WHEN ${assertions.join(' AND ')} THEN 1 ELSE RAISE(ABORT,'production_not_empty') END;
      DELETE FROM queue WHERE id IN ('demo-queue','confirmation-experiment');
      DELETE FROM venue WHERE id='demo-venue';
      DELETE FROM organization WHERE id='demo-org';
      INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt)
        VALUES (${quote(randomUUID())},NEW.id,'credential',NEW.id,${quote(passwordHash)},NEW.createdAt,NEW.updatedAt);
    END;`,
    insert: `INSERT INTO user(id,name,email,username,displayUsername,emailVerified,createdAt,updatedAt,role,banned)
      VALUES (${quote(id)},${quote(name)},${quote(`${id}@accounts.noqueue.invalid`)},${quote(username)},${quote(username)},0,${quote(now)},${quote(now)},'platform_admin',0)
      ON CONFLICT(username) DO NOTHING;`,
    drop: `DROP TRIGGER IF EXISTS ${identifier(trigger)};`,
    verify: `SELECT u.id,u.role,u.banned,COUNT(a.id) AS credentials FROM user u LEFT JOIN account a ON a.userId=u.id AND a.providerId='credential' AND a.password IS NOT NULL WHERE u.username=${quote(username)} GROUP BY u.id;`,
  }
}
