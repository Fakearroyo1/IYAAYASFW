-- Forward-only merchandise-spending recognition. Existing orders, balances and
-- earned rewards are never rewritten or backfilled by this migration.
CREATE TABLE IF NOT EXISTS earning_settings (
 id TEXT PRIMARY KEY CHECK(id='main'), starts_at INTEGER NOT NULL,
 weekly_cap_points INTEGER NOT NULL DEFAULT 0 CHECK(weekly_cap_points BETWEEN 0 AND 100000),
 version INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO earning_settings(id,starts_at) VALUES('main',CAST(strftime('%s','now') AS INTEGER)*1000);
CREATE TABLE IF NOT EXISTS earning_accounts (
 member_id TEXT PRIMARY KEY REFERENCES members(id), reward_credit_cents INTEGER NOT NULL DEFAULT 0 CHECK(reward_credit_cents>=0),
 awarded_points INTEGER NOT NULL DEFAULT 0 CHECK(awarded_points>=0), reward_tab_cents INTEGER NOT NULL DEFAULT 0 CHECK(reward_tab_cents>=0),
 refund_carry_suppressed_points INTEGER NOT NULL DEFAULT 0 CHECK(refund_carry_suppressed_points>=0), version INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO earning_accounts(member_id) SELECT id FROM members;
CREATE TRIGGER IF NOT EXISTS earning_new_member AFTER INSERT ON members BEGIN
 INSERT OR IGNORE INTO earning_accounts(member_id) VALUES(NEW.id);
END;
-- A manual decrease cannot leave more reward-derived credit than total credit.
-- Financial operations explicitly preserve the more precise provenance below.
CREATE TRIGGER IF NOT EXISTS earning_member_balance_revision AFTER UPDATE OF debt,credit ON members WHEN OLD.debt<>NEW.debt OR OLD.credit<>NEW.credit BEGIN
 UPDATE earning_accounts SET reward_credit_cents=MIN(reward_credit_cents,NEW.credit),version=version+1 WHERE member_id=NEW.id;
END;
CREATE TABLE IF NOT EXISTS earning_credit_grants (
 source_id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),cents INTEGER NOT NULL CHECK(cents>0),created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS earning_credit_grant_no_update BEFORE UPDATE ON earning_credit_grants BEGIN SELECT RAISE(ABORT,'Reward credit grants are immutable'); END;
CREATE TRIGGER IF NOT EXISTS earning_credit_grant_no_delete BEFORE DELETE ON earning_credit_grants BEGIN SELECT RAISE(ABORT,'Reward credit grants are immutable'); END;
CREATE TABLE IF NOT EXISTS earning_orders (
 order_id TEXT PRIMARY KEY REFERENCES orders(id),member_id TEXT NOT NULL REFERENCES members(id),created_at INTEGER NOT NULL,
 gross_cents INTEGER NOT NULL CHECK(gross_cents>=0),merchandise_cents INTEGER NOT NULL CHECK(merchandise_cents>=0 AND merchandise_cents<=gross_cents),
 eligible_paid_cents INTEGER NOT NULL CHECK(eligible_paid_cents>=0),reward_paid_cents INTEGER NOT NULL CHECK(reward_paid_cents>=0),
 tab_remaining_cents INTEGER NOT NULL CHECK(tab_remaining_cents>=0),cash_remaining_cents INTEGER NOT NULL CHECK(cash_remaining_cents>=0),
 recognized_cents INTEGER NOT NULL CHECK(recognized_cents>=0),forgiven_cents INTEGER NOT NULL DEFAULT 0 CHECK(forgiven_cents>=0),
 CHECK(eligible_paid_cents+reward_paid_cents+tab_remaining_cents+cash_remaining_cents+forgiven_cents=gross_cents)
);
CREATE INDEX IF NOT EXISTS earning_orders_member ON earning_orders(member_id,created_at,order_id);
-- Cap is snapshotted on the first earning event of each UTC Monday-based week.
-- Changes affect the next week, never the member's already-earned entitlement.
CREATE TABLE IF NOT EXISTS earning_periods (
 id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),starts_at INTEGER NOT NULL,cap_points INTEGER NOT NULL CHECK(cap_points>=0),
 remaining_cents INTEGER NOT NULL DEFAULT 0 CHECK(remaining_cents>=0),
 UNIQUE(member_id,starts_at)
);
CREATE TABLE IF NOT EXISTS earning_sources (
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES earning_orders(order_id),member_id TEXT NOT NULL REFERENCES members(id),
 period_id TEXT NOT NULL REFERENCES earning_periods(id),original_cents INTEGER NOT NULL CHECK(original_cents>0),
 remaining_cents INTEGER NOT NULL CHECK(remaining_cents>=0 AND remaining_cents<=original_cents),created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS earning_sources_member ON earning_sources(member_id,created_at,id);
CREATE INDEX IF NOT EXISTS earning_sources_order ON earning_sources(order_id,created_at,id);
CREATE TABLE IF NOT EXISTS earning_operations (
 id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),kind TEXT NOT NULL,detail TEXT NOT NULL,points_delta INTEGER NOT NULL,created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS earning_operation_no_update BEFORE UPDATE ON earning_operations BEGIN SELECT RAISE(ABORT,'Spending recognition history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS earning_operation_no_delete BEFORE DELETE ON earning_operations BEGIN SELECT RAISE(ABORT,'Spending recognition history is immutable'); END;
-- Replace only the fixed daily purchase bonus. Keep historical points, manual
-- awards, community awards and the on-time settlement award unchanged.
DROP TRIGGER IF EXISTS reward_purchase_insert;
DROP TRIGGER IF EXISTS reward_purchase_paid;
UPDATE reward_rules SET enabled=0 WHERE id='purchase' AND enabled<>0;
-- Reward-funded debt must not mint the retained on-time settlement bonus.
-- Once reward credit has funded part of a tab cycle, the whole cycle is ineligible.
DROP TRIGGER IF EXISTS reward_tab_settled;
CREATE TRIGGER reward_tab_settled AFTER INSERT ON balance_ledger
 WHEN NEW.kind IN('credit_settlement','payment_confirmed') AND NEW.debt_delta<0
 AND (SELECT debt FROM members WHERE id=NEW.member_id)=0
 AND COALESCE((SELECT reward_tab_cents FROM earning_accounts WHERE member_id=NEW.member_id),0)=0
 AND EXISTS(SELECT 1 FROM payments WHERE id=NEW.payment_id AND member_id=NEW.member_id AND purpose='settlement' AND status='verified')
 AND NEW.created_at>=(SELECT starts_at FROM reward_settings WHERE id='main')
 AND EXISTS(SELECT 1 FROM reward_tab_origins t JOIN settings s ON s.id='main' WHERE t.member_id=NEW.member_id AND t.due_since IS NOT NULL AND NEW.created_at-t.due_since<=s.reminder_days*86400000)
 BEGIN
 INSERT OR IGNORE INTO reward_events(id,member_id,rule_id,source,actor,note,created_at)
 VALUES('settlement:'||NEW.payment_id,NEW.member_id,'settlement',NEW.payment_id,'system','Tab fully settled within the configured reminder period.',NEW.created_at);
END;
