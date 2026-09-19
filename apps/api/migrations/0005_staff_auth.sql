-- Better Auth 1.7.5 + Organization/Admin/Username. D1 dates are ISO text.
CREATE TABLE "user" (
  id TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "username" TEXT UNIQUE,
  "displayUsername" TEXT,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "role" TEXT,
  "banned" INTEGER DEFAULT 0,
  "banReason" TEXT,
  "banExpires" TEXT
);
CREATE TABLE "session" (
  id TEXT PRIMARY KEY,
  "expiresAt" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "activeOrganizationId" TEXT,
  "impersonatedBy" TEXT
);
CREATE INDEX "session_userId" ON "session"("userId");
CREATE TABLE "account" (
  id TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TEXT,
  "refreshTokenExpiresAt" TEXT,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX "account_userId" ON "account"("userId");
CREATE TABLE "verification" (
  id TEXT PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX "verification_identifier" ON "verification"("identifier");
ALTER TABLE organization ADD COLUMN slug TEXT;
ALTER TABLE organization ADD COLUMN logo TEXT;
ALTER TABLE organization ADD COLUMN metadata TEXT;
ALTER TABLE organization ADD COLUMN "createdAt" TEXT;
UPDATE organization SET slug=id, "createdAt"='2026-09-19T00:00:00.000Z';
CREATE UNIQUE INDEX organization_slug ON organization(slug);
CREATE TABLE "member" (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL DEFAULT 'member',
  "createdAt" TEXT NOT NULL
);
CREATE INDEX "member_organizationId" ON "member"("organizationId");
CREATE INDEX "member_userId" ON "member"("userId");
CREATE TABLE "invitation" (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "role" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "inviterId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX "invitation_organizationId" ON "invitation"("organizationId");
CREATE INDEX "invitation_email" ON "invitation"("email");
CREATE TABLE "rateLimit" (
  id TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" INTEGER NOT NULL
);
CREATE UNIQUE INDEX member_user_org ON member("organizationId","userId");
ALTER TABLE venue ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/Madrid';
ALTER TABLE queue ADD COLUMN name TEXT NOT NULL DEFAULT 'Cola';
ALTER TABLE queue ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue ADD COLUMN config TEXT;
ALTER TABLE queue_entry ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue_entry ADD COLUMN called_at INTEGER;
CREATE TABLE venue_membership (
  user_id TEXT NOT NULL REFERENCES user(id), venue_id TEXT NOT NULL REFERENCES venue(id),
  role TEXT NOT NULL CHECK(role IN ('owner','venue_manager','queue_staff','viewer')),
  active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id,venue_id)
);
CREATE TABLE tenant_account (
  organization_id TEXT PRIMARY KEY REFERENCES organization(id), created_by TEXT NOT NULL REFERENCES user(id),
  provisioning_mode TEXT NOT NULL DEFAULT 'sales', billing_mode TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended'))
);
CREATE TABLE staff_audit (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES user(id), organization_id TEXT NOT NULL REFERENCES organization(id),
  venue_id TEXT, action TEXT NOT NULL, target_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE provisioning_request (
  actor_id TEXT NOT NULL REFERENCES user(id), request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization(id), result TEXT NOT NULL, PRIMARY KEY(actor_id,request_key)
);
CREATE TABLE staff_command (
  actor_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  result TEXT NOT NULL, PRIMARY KEY(actor_id,request_key)
);
CREATE TABLE staff_rate (key TEXT PRIMARY KEY, count INTEGER NOT NULL);
CREATE INDEX staff_audit_org ON staff_audit(organization_id,created_at);
