-- Murley Bucks are recognition points, never funds, credit, or a purchase currency.
CREATE TABLE IF NOT EXISTS reward_settings (
 id TEXT PRIMARY KEY CHECK(id='main'),starts_at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0,
 tiers TEXT NOT NULL DEFAULT '[{"name":"Member","threshold":0,"slots":0,"accent":false,"bio":false,"avatar":false,"banner":false,"theme":false},{"name":"Supporter","threshold":25,"slots":1,"accent":true,"bio":false,"avatar":false,"banner":false,"theme":false},{"name":"Regular","threshold":75,"slots":2,"accent":true,"bio":true,"avatar":false,"banner":false,"theme":false},{"name":"Crew","threshold":150,"slots":3,"accent":true,"bio":true,"avatar":true,"banner":false,"theme":false},{"name":"Champion","threshold":300,"slots":4,"accent":true,"bio":true,"avatar":true,"banner":true,"theme":false},{"name":"Legend","threshold":600,"slots":5,"accent":true,"bio":true,"avatar":true,"banner":true,"theme":true}]',
 titles TEXT NOT NULL DEFAULT '["Snack Dump Chief","Big Bombs Boss","Line-D Legend","Jammer Ace","Load Crew Loyalist"]'
);
INSERT OR IGNORE INTO reward_settings(id,starts_at) VALUES('main',CAST(strftime('%s','now') AS INTEGER)*1000);
CREATE TABLE IF NOT EXISTS reward_rules (
 id TEXT PRIMARY KEY,label TEXT NOT NULL,points INTEGER NOT NULL CHECK(points BETWEEN 0 AND 1000),period_cap INTEGER NOT NULL CHECK(period_cap BETWEEN 0 AND 10000),period_ms INTEGER NOT NULL CHECK(period_ms IN(86400000,604800000)),enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),version INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO reward_rules(id,label,points,period_cap,period_ms,enabled) VALUES
 ('purchase','First completed purchase of the day',5,5,86400000,1),('settlement','On-time full tab settlement',10,10,604800000,1),
 ('helpful_review','Helpful verified review',5,10,604800000,1),('accepted_request','Accepted product request',10,20,604800000,1),
 ('feedback','Useful feedback',5,10,604800000,1),('volunteer','Volunteer / restock support',20,60,604800000,1),('event','Event participation',10,30,604800000,1);
CREATE TABLE IF NOT EXISTS reward_members(member_id TEXT PRIMARY KEY REFERENCES members(id),frozen INTEGER NOT NULL DEFAULT 0 CHECK(frozen IN(0,1)),reason TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS reward_events(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),rule_id TEXT NOT NULL REFERENCES reward_rules(id),source TEXT NOT NULL,actor TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reward_ledger (
 id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),amount INTEGER NOT NULL CHECK(amount<>0 AND amount BETWEEN -100000 AND 100000),
 rule_id TEXT NOT NULL,source TEXT NOT NULL,actor TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL,
 event_id TEXT UNIQUE REFERENCES reward_events(id),reverses TEXT UNIQUE REFERENCES reward_ledger(id)
);
CREATE INDEX IF NOT EXISTS reward_member_history ON reward_ledger(member_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS reward_member_rule_period ON reward_ledger(member_id,rule_id,created_at);
CREATE TRIGGER IF NOT EXISTS reward_ledger_no_update BEFORE UPDATE ON reward_ledger BEGIN SELECT RAISE(ABORT,'Murley Bucks ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS reward_ledger_no_delete BEFORE DELETE ON reward_ledger BEGIN SELECT RAISE(ABORT,'Murley Bucks ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS reward_event_no_update BEFORE UPDATE ON reward_events BEGIN SELECT RAISE(ABORT,'Reward events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS reward_event_no_delete BEFORE DELETE ON reward_events BEGIN SELECT RAISE(ABORT,'Reward events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS reward_event_award AFTER INSERT ON reward_events
 WHEN NEW.created_at>=(SELECT starts_at FROM reward_settings WHERE id='main') AND COALESCE((SELECT frozen FROM reward_members WHERE member_id=NEW.member_id),0)=0
 BEGIN
 INSERT OR IGNORE INTO reward_ledger(id,member_id,amount,rule_id,source,actor,note,created_at,event_id)
 SELECT 'event:'||NEW.id,NEW.member_id,MIN(r.points,MAX(0,r.period_cap-COALESCE((SELECT SUM(l.amount) FROM reward_ledger l WHERE l.member_id=NEW.member_id AND l.rule_id=r.id AND l.amount>0 AND l.created_at>=CAST(NEW.created_at/r.period_ms AS INTEGER)*r.period_ms AND l.created_at<(CAST(NEW.created_at/r.period_ms AS INTEGER)+1)*r.period_ms),0))),r.id,NEW.source,NEW.actor,NEW.note,NEW.created_at,NEW.id
 FROM reward_rules r WHERE r.id=NEW.rule_id AND r.enabled=1 AND r.points>0 AND r.period_cap>COALESCE((SELECT SUM(l.amount) FROM reward_ledger l WHERE l.member_id=NEW.member_id AND l.rule_id=r.id AND l.amount>0 AND l.created_at>=CAST(NEW.created_at/r.period_ms AS INTEGER)*r.period_ms AND l.created_at<(CAST(NEW.created_at/r.period_ms AS INTEGER)+1)*r.period_ms),0);
 END;
CREATE TRIGGER IF NOT EXISTS reward_purchase_insert AFTER INSERT ON orders WHEN NEW.member_id IS NOT NULL AND NEW.status IN('paid','tab') AND NEW.created_at>=(SELECT starts_at FROM reward_settings WHERE id='main') BEGIN
 INSERT OR IGNORE INTO reward_events(id,member_id,rule_id,source,actor,note,created_at) VALUES('purchase:'||NEW.id,NEW.member_id,'purchase',NEW.id,'system','First completed purchase in the daily reward window.',NEW.created_at); END;
CREATE TRIGGER IF NOT EXISTS reward_purchase_paid AFTER UPDATE OF status ON orders WHEN NEW.member_id IS NOT NULL AND NEW.status='paid' AND OLD.status='pending' AND NEW.created_at>=(SELECT starts_at FROM reward_settings WHERE id='main') BEGIN
 INSERT OR IGNORE INTO reward_events(id,member_id,rule_id,source,actor,note,created_at) VALUES('purchase:'||NEW.id,NEW.member_id,'purchase',NEW.id,'system','Purchase payment confirmed.',CAST(strftime('%s','now') AS INTEGER)*1000); END;
CREATE TRIGGER IF NOT EXISTS reward_purchase_void AFTER UPDATE OF status ON orders WHEN NEW.status='void' AND OLD.status<>'void' BEGIN
 INSERT OR IGNORE INTO reward_ledger(id,member_id,amount,rule_id,source,actor,note,created_at,reverses) SELECT 'void:'||id,member_id,-amount,'reversal',source,'system','Purchase voided; recognition reversed.',CAST(strftime('%s','now') AS INTEGER)*1000,id FROM reward_ledger WHERE event_id='purchase:'||NEW.id AND amount>0; END;
CREATE TRIGGER IF NOT EXISTS reward_request_accepted AFTER UPDATE OF status ON item_requests WHEN NEW.status='accepted' AND OLD.status<>'accepted' AND NEW.removed=0 BEGIN
 INSERT OR IGNORE INTO reward_events(id,member_id,rule_id,source,actor,note,created_at) VALUES('request:'||NEW.id,NEW.member_id,'accepted_request',NEW.id,'system','Product request accepted by an administrator.',CAST(strftime('%s','now') AS INTEGER)*1000); END;
CREATE TABLE IF NOT EXISTS member_profiles (
 member_id TEXT PRIMARY KEY REFERENCES members(id),public_id TEXT NOT NULL UNIQUE,alias TEXT NOT NULL DEFAULT '',bio TEXT NOT NULL DEFAULT '',accent TEXT NOT NULL DEFAULT 'blue',theme TEXT NOT NULL DEFAULT 'classic',
 visible INTEGER NOT NULL DEFAULT 0 CHECK(visible IN(0,1)),board_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(board_opt_in IN(0,1)),
 moderation TEXT NOT NULL DEFAULT 'pending' CHECK(moderation IN('pending','approved','hidden')),version INTEGER NOT NULL DEFAULT 0,
 avatar_id TEXT,banner_id TEXT,display_badges TEXT NOT NULL DEFAULT '[]',updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_images(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),kind TEXT NOT NULL CHECK(kind IN('avatar','banner')),object_key TEXT NOT NULL UNIQUE,width INTEGER NOT NULL,height INTEGER NOT NULL,created_at INTEGER NOT NULL,removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN(0,1)));
CREATE TABLE IF NOT EXISTS profile_reports(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES member_profiles(public_id),reporter TEXT NOT NULL REFERENCES members(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved')),created_at INTEGER NOT NULL,resolution TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS profile_report_open ON profile_reports(status,created_at);
CREATE TABLE IF NOT EXISTS badge_definitions (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,criteria TEXT NOT NULL,category TEXT NOT NULL,rarity TEXT NOT NULL,color TEXT NOT NULL,symbol TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS badge_awards (
 id TEXT PRIMARY KEY,badge_id TEXT NOT NULL REFERENCES badge_definitions(id),member_id TEXT NOT NULL REFERENCES members(id),issuer TEXT NOT NULL,reason TEXT NOT NULL,issued_at INTEGER NOT NULL,expires_at INTEGER,revoked_at INTEGER,revoked_by TEXT,revoke_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS badge_one_active ON badge_awards(badge_id,member_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS reward_seasons(id TEXT PRIMARY KEY,name TEXT NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,archived_at INTEGER,version INTEGER NOT NULL DEFAULT 0,CHECK(ends_at>starts_at));
CREATE TABLE IF NOT EXISTS reward_season_results(season_id TEXT NOT NULL REFERENCES reward_seasons(id),member_id TEXT NOT NULL REFERENCES members(id),points INTEGER NOT NULL,place INTEGER NOT NULL,PRIMARY KEY(season_id,member_id));
INSERT OR IGNORE INTO badge_definitions(id,name,description,criteria,category,rarity,color,symbol) VALUES
 ('founding-crew','Founding Crew','Helped launch the unit store.','Administrator confirms beta participation.','Recognition','Special','indigo','star'),
 ('helping-hands','Helping Hands','Supported a restock or unit activity.','Administrator confirms volunteer support.','Support','Earned','green','hands'),
 ('product-scout','Product Scout','Brought a useful product idea to the team.','Administrator confirms a helpful accepted request.','Community','Earned','orange','compass'),
 ('reliable-crew','Reliable Crew','Consistently supports timely tab settlement.','Administrator reviews settlement history.','Support','Earned','blue','shield');
CREATE TABLE IF NOT EXISTS reward_tab_origins(member_id TEXT PRIMARY KEY REFERENCES members(id),due_since INTEGER);
INSERT OR IGNORE INTO reward_tab_origins(member_id,due_since) SELECT id,due_since FROM members WHERE debt>0;
CREATE TRIGGER IF NOT EXISTS reward_tab_origin AFTER UPDATE OF debt ON members WHEN OLD.debt<>NEW.debt BEGIN
 INSERT INTO reward_tab_origins(member_id,due_since) VALUES(NEW.id,CASE WHEN NEW.debt=0 THEN OLD.due_since ELSE NEW.due_since END) ON CONFLICT(member_id) DO UPDATE SET due_since=excluded.due_since; END;
CREATE TRIGGER IF NOT EXISTS reward_tab_settled AFTER INSERT ON balance_ledger WHEN NEW.kind IN('credit_settlement','payment_confirmed') AND NEW.debt_delta<0 AND (SELECT debt FROM members WHERE id=NEW.member_id)=0 AND EXISTS(SELECT 1 FROM payments WHERE id=NEW.payment_id AND member_id=NEW.member_id AND purpose='settlement' AND status='verified') AND NEW.created_at>=(SELECT starts_at FROM reward_settings WHERE id='main') AND EXISTS(SELECT 1 FROM reward_tab_origins t JOIN settings s ON s.id='main' WHERE t.member_id=NEW.member_id AND t.due_since IS NOT NULL AND NEW.created_at-t.due_since<=s.reminder_days*86400000) BEGIN
 INSERT OR IGNORE INTO reward_events(id,member_id,rule_id,source,actor,note,created_at) VALUES('settlement:'||NEW.payment_id,NEW.member_id,'settlement',NEW.payment_id,'system','Tab fully settled within the configured reminder period.',NEW.created_at); END;
-- New task sources join the existing single admin inbox; underlying actions resolve them.
CREATE VIEW IF NOT EXISTS operational_tasks_4(task_key,type,target,reference,title,person,amount,severity,created_at,due_at,active,destination,dismissible) AS
SELECT 'guest:'||g.order_id,'guest',g.order_id,o.code,'Guest gear fulfillment',o.payer,NULL,'normal',g.created_at,NULL,o.status='paid' AND g.state NOT IN('completed','cancelled','expired'),'guest',0 FROM guest_orders g JOIN orders o ON o.id=g.order_id
UNION ALL SELECT 'profile:'||p.public_id,'profile',p.public_id,'PROFILE-'||upper(substr(p.public_id,1,8)),'Review member profile',p.alias,NULL,'normal',p.updated_at,NULL,p.moderation='pending','rewards',0 FROM member_profiles p
UNION ALL SELECT 'profile-report:'||r.id,'profile-report',r.id,'REPORT-'||upper(substr(r.id,1,8)),'Review profile report',p.alias,NULL,'high',r.created_at,NULL,r.status='open','rewards',0 FROM profile_reports r JOIN member_profiles p ON p.public_id=r.profile_id;
DROP VIEW IF EXISTS operational_tasks;
CREATE VIEW operational_tasks AS SELECT * FROM operational_tasks_0 UNION ALL SELECT * FROM operational_tasks_1 UNION ALL SELECT * FROM operational_tasks_2 UNION ALL SELECT * FROM operational_tasks_3 UNION ALL SELECT * FROM operational_tasks_4;
-- Start with the current calendar-quarter season. Existing administrator-defined
-- windows win; deployment never overwrites or overlaps their seasons.
INSERT OR IGNORE INTO reward_seasons(id,name,starts_at,ends_at)
 SELECT strftime('%Y','now')||'-Q'||(CAST((CAST(strftime('%m','now') AS INTEGER)-1)/3 AS INTEGER)+1),
 strftime('%Y','now')||' · Quarter '||(CAST((CAST(strftime('%m','now') AS INTEGER)-1)/3 AS INTEGER)+1),
 CAST(strftime('%s',strftime('%Y','now')||printf('-%02d-01',CAST((CAST(strftime('%m','now') AS INTEGER)-1)/3 AS INTEGER)*3+1)) AS INTEGER)*1000,
 CAST(strftime('%s',strftime('%Y','now')||printf('-%02d-01',CAST((CAST(strftime('%m','now') AS INTEGER)-1)/3 AS INTEGER)*3+1),'+3 months') AS INTEGER)*1000
 WHERE NOT EXISTS(SELECT 1 FROM reward_seasons WHERE starts_at<CAST(strftime('%s',strftime('%Y','now')||printf('-%02d-01',CAST((CAST(strftime('%m','now') AS INTEGER)-1)/3 AS INTEGER)*3+1),'+3 months') AS INTEGER)*1000 AND ends_at>CAST(strftime('%s',strftime('%Y','now')||printf('-%02d-01',CAST((CAST(strftime('%m','now') AS INTEGER)-1)/3 AS INTEGER)*3+1)) AS INTEGER)*1000);
