-- Additive identity metadata in the established D1. Apply after all existing
-- schemas. No member, ledger, balance, reward, order or stock is rewritten.
CREATE TABLE IF NOT EXISTS identity_clock (id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL);
INSERT OR IGNORE INTO identity_clock(id,generation) VALUES(1,0);
CREATE TABLE IF NOT EXISTS identity_state (
 member_id TEXT PRIMARY KEY REFERENCES members(id), epoch INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0, invalidated_at INTEGER NOT NULL DEFAULT 0, user_handle TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO identity_state(member_id,user_handle,created_at)
 SELECT id,lower(hex(randomblob(32))),unixepoch()*1000 FROM members;
CREATE TABLE IF NOT EXISTS identity_credentials (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
 kind TEXT NOT NULL CHECK(kind IN ('google','microsoft','passkey')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','blocked')),
 issuer TEXT, subject TEXT, client_id TEXT, observed_email TEXT, tenant_id TEXT, object_id TEXT,
 credential_id TEXT UNIQUE, public_key TEXT, counter INTEGER NOT NULL DEFAULT 0,
 user_handle TEXT, rp_id TEXT, transports TEXT, backed_up INTEGER, device_type TEXT,
 label TEXT NOT NULL, provenance TEXT NOT NULL, policy_version TEXT NOT NULL DEFAULT '2026-09-21-v1',
 created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER,
 CHECK((kind='passkey' AND credential_id IS NOT NULL AND public_key IS NOT NULL AND rp_id IS NOT NULL AND user_handle IS NOT NULL)
 OR (kind IN ('google','microsoft') AND issuer IS NOT NULL AND subject IS NOT NULL AND client_id IS NOT NULL)),
 UNIQUE(issuer,subject)
);
CREATE INDEX IF NOT EXISTS identity_credentials_member ON identity_credentials(member_id,status);
CREATE TABLE IF NOT EXISTS identity_admin_principals (
 id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
 member_id TEXT NOT NULL REFERENCES members(id), identity_owner INTEGER NOT NULL DEFAULT 0 CHECK(identity_owner IN (0,1)),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 provisioned_at INTEGER NOT NULL, evidence TEXT NOT NULL, UNIQUE(issuer,subject)
);
CREATE UNIQUE INDEX IF NOT EXISTS identity_single_owner ON identity_admin_principals(identity_owner) WHERE identity_owner=1 AND status='active';
CREATE TABLE IF NOT EXISTS identity_grants (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
 kind TEXT NOT NULL CHECK(kind IN ('invite','bootstrap','enrollment','action')),
 purpose TEXT NOT NULL, provider TEXT, match_email TEXT, raw_email TEXT, token_hash TEXT UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','consumed','revoked','expired')),
 epoch INTEGER NOT NULL, source_session TEXT, proof_credential TEXT, proof_at INTEGER,
 flow_id TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 consumed_at INTEGER, result_credential TEXT, version INTEGER NOT NULL DEFAULT 0,
 CHECK(kind<>'bootstrap' OR (provider IN ('google','microsoft') AND match_email IS NOT NULL))
);
-- History stays reserved: re-import cannot recreate claimed/revoked addresses.
CREATE UNIQUE INDEX IF NOT EXISTS identity_bootstrap_reservation ON identity_grants(provider,match_email) WHERE kind='bootstrap';
CREATE INDEX IF NOT EXISTS identity_grants_member ON identity_grants(member_id,status);
CREATE TABLE IF NOT EXISTS identity_flows (
 id TEXT PRIMARY KEY, purpose TEXT NOT NULL CHECK(purpose IN ('login','fresh','enroll')),
 audience TEXT NOT NULL DEFAULT 'member' CHECK(audience IN ('member','admin')),
 destination_browser TEXT, verifier TEXT, verifier_hash TEXT, return_path TEXT NOT NULL DEFAULT '/',
 auth_browser TEXT, register_browser TEXT, member_id TEXT REFERENCES members(id), epoch INTEGER,
 source_session TEXT, action TEXT, action_payload TEXT, grant_id TEXT REFERENCES identity_grants(id),
 credential_id TEXT REFERENCES identity_credentials(id), proof TEXT, proof_at INTEGER,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','proven','completed','revoked')),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_generation INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS identity_flows_member ON identity_flows(member_id,status);
CREATE TABLE IF NOT EXISTS identity_ceremonies (
 id_hash TEXT PRIMARY KEY, flow_id TEXT NOT NULL REFERENCES identity_flows(id),
 kind TEXT NOT NULL, browser_hash TEXT NOT NULL, secret TEXT,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE INDEX IF NOT EXISTS identity_ceremonies_flow ON identity_ceremonies(flow_id,kind);
CREATE TABLE IF NOT EXISTS identity_handoffs (
 code_hash TEXT PRIMARY KEY, flow_id TEXT NOT NULL UNIQUE REFERENCES identity_flows(id),
 member_id TEXT NOT NULL REFERENCES members(id), credential_id TEXT REFERENCES identity_credentials(id),
 epoch INTEGER NOT NULL, purpose TEXT NOT NULL, callback TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
);
CREATE TABLE IF NOT EXISTS identity_sessions (
 token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
 audience TEXT NOT NULL CHECK(audience IN ('member','admin')), epoch INTEGER NOT NULL,
 credential_id TEXT REFERENCES identity_credentials(id), principal_id TEXT REFERENCES identity_admin_principals(id),
 auth_time INTEGER NOT NULL, created_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL,
 absolute_expires_at INTEGER NOT NULL, ended_at INTEGER, end_reason TEXT,
 CHECK((audience='member' AND credential_id IS NOT NULL AND principal_id IS NULL)
 OR (audience='admin' AND principal_id IS NOT NULL AND credential_id IS NULL))
);
CREATE INDEX IF NOT EXISTS identity_sessions_member ON identity_sessions(member_id,ended_at);
CREATE TABLE IF NOT EXISTS identity_requests (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, issuer TEXT NOT NULL, subject TEXT NOT NULL,
 client_id TEXT NOT NULL, observed_email TEXT, tenant_id TEXT, object_id TEXT,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','linked','rejected','blocked','expired')),
 attempts INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
 reviewed_at INTEGER, reviewed_by TEXT, member_id TEXT REFERENCES members(id), reason TEXT,
 UNIQUE(issuer,subject)
);
CREATE TABLE IF NOT EXISTS identity_contacts (
 member_id TEXT PRIMARY KEY REFERENCES members(id), email TEXT NOT NULL,
 updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS identity_imports (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, payload_hash TEXT NOT NULL,
 rows_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS identity_import_rows (
 batch_id TEXT NOT NULL REFERENCES identity_imports(id), row_number INTEGER NOT NULL,
 member_id TEXT NOT NULL REFERENCES members(id), result TEXT NOT NULL, committed_at INTEGER NOT NULL,
 PRIMARY KEY(batch_id,row_number)
);
CREATE TABLE IF NOT EXISTS identity_audit (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, event TEXT NOT NULL, target TEXT NOT NULL,
 detail TEXT NOT NULL, created_at INTEGER NOT NULL, incident_hold INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS identity_audit_target ON identity_audit(target,created_at DESC);
CREATE INDEX IF NOT EXISTS identity_audit_retention ON identity_audit(incident_hold,created_at);

CREATE TRIGGER IF NOT EXISTS identity_member_created AFTER INSERT ON members BEGIN
 INSERT INTO identity_state(member_id,user_handle,created_at) VALUES(NEW.id,lower(hex(randomblob(32))),unixepoch()*1000);
END;
CREATE TRIGGER IF NOT EXISTS identity_access_changed AFTER UPDATE OF active,role ON members
 WHEN OLD.active<>NEW.active OR OLD.role<>NEW.role BEGIN
 DELETE FROM auth_sessions WHERE member_id=NEW.id;
 UPDATE identity_state SET epoch=epoch+1,version=version+1 WHERE member_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS identity_shop_access_changed AFTER UPDATE OF snacks,gear ON member_access
 WHEN OLD.snacks<>NEW.snacks OR OLD.gear<>NEW.gear BEGIN
 DELETE FROM auth_sessions WHERE member_id=NEW.member_id;
 UPDATE identity_state SET epoch=epoch+1,version=version+1 WHERE member_id=NEW.member_id;
END;
CREATE TRIGGER IF NOT EXISTS identity_shop_access_inserted AFTER INSERT ON member_access
 WHEN NEW.snacks<>1 OR NEW.gear<>1 BEGIN
 DELETE FROM auth_sessions WHERE member_id=NEW.member_id;
 UPDATE identity_state SET epoch=epoch+1,version=version+1 WHERE member_id=NEW.member_id;
END;
-- Password replacement invalidates new ceremonies even if the old code predates
-- this release. Legacy current-device password-change behavior is retained.
CREATE TRIGGER IF NOT EXISTS identity_password_changed AFTER UPDATE OF password_hash ON auth_credentials
 WHEN OLD.password_hash<>NEW.password_hash BEGIN
 UPDATE identity_state SET epoch=epoch+1,version=version+1 WHERE member_id=NEW.member_id;
END;
CREATE TRIGGER IF NOT EXISTS identity_epoch_changed AFTER UPDATE OF epoch ON identity_state
 WHEN OLD.epoch<>NEW.epoch BEGIN
 UPDATE identity_clock SET generation=generation+1 WHERE id=1;
 UPDATE identity_state SET generation=(SELECT generation FROM identity_clock WHERE id=1),invalidated_at=CAST((julianday('now')-2440587.5)*86400000+0.999 AS INTEGER) WHERE member_id=NEW.member_id;
 DELETE FROM auth_sessions WHERE member_id=NEW.member_id AND token_hash IN (SELECT token_hash FROM identity_sessions);
 UPDATE identity_grants SET status='revoked',version=version+1 WHERE member_id=NEW.member_id AND status='pending';
 UPDATE identity_flows SET status='revoked',proof=NULL,verifier=NULL WHERE member_id=NEW.member_id AND status IN ('pending','proven');
 DELETE FROM auth_setup WHERE member_id=NEW.member_id;
 DELETE FROM auth_recovery WHERE member_id=NEW.member_id;
END;
CREATE TRIGGER IF NOT EXISTS identity_member_details_changed AFTER UPDATE OF name,email ON members
 WHEN OLD.name<>NEW.name OR OLD.email<>NEW.email BEGIN
 UPDATE identity_state SET version=version+1 WHERE member_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS identity_session_ended AFTER DELETE ON auth_sessions BEGIN
 UPDATE identity_sessions SET ended_at=COALESCE(ended_at,unixepoch()*1000),end_reason=COALESCE(end_reason,'session ended') WHERE token_hash=OLD.token_hash;
 UPDATE identity_grants SET status='revoked',version=version+1 WHERE source_session=OLD.token_hash AND status='pending';
 UPDATE identity_flows SET status='revoked',proof=NULL,verifier=NULL WHERE source_session=OLD.token_hash AND status IN ('pending','proven');
END;
CREATE TRIGGER IF NOT EXISTS identity_method_revoked AFTER UPDATE OF status ON identity_credentials
 WHEN NEW.status<>'active' AND OLD.status='active' BEGIN
 DELETE FROM auth_sessions WHERE token_hash IN (SELECT token_hash FROM identity_sessions WHERE credential_id=NEW.id);
 UPDATE identity_grants SET status='revoked',version=version+1 WHERE proof_credential=NEW.id AND status='pending';
 UPDATE identity_flows SET status='revoked',proof=NULL,verifier=NULL WHERE credential_id=NEW.id AND status IN ('pending','proven');
 UPDATE identity_state SET version=version+1 WHERE member_id=NEW.member_id;
END;
CREATE TRIGGER IF NOT EXISTS identity_principal_revoked AFTER UPDATE OF status,identity_owner ON identity_admin_principals
 WHEN OLD.status<>NEW.status OR OLD.identity_owner<>NEW.identity_owner BEGIN
 DELETE FROM auth_sessions WHERE token_hash IN (SELECT token_hash FROM identity_sessions WHERE principal_id=NEW.id);
END;
