-- Redemption spending is separate from recognition history and Support Board scores.
-- Rerunnable and additive: existing points, balances, orders and badge awards stay intact.
CREATE TABLE IF NOT EXISTS reward_raffles (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',
 mode TEXT NOT NULL CHECK(mode IN('internal','external')),active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)),
 starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','drawn')),
 ticket_count INTEGER NOT NULL DEFAULT 0 CHECK(ticket_count BETWEEN 0 AND 100000),
 version INTEGER NOT NULL DEFAULT 0,created_by TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,CHECK(ends_at>starts_at)
);
CREATE TABLE IF NOT EXISTS redemption_rewards (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL CHECK(kind IN('credit','raffle')),
 points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 100000),credit_cents INTEGER NOT NULL DEFAULT 0 CHECK(credit_cents BETWEEN 0 AND 50000),
 ticket_quantity INTEGER NOT NULL DEFAULT 0 CHECK(ticket_quantity BETWEEN 0 AND 100),raffle_id TEXT REFERENCES reward_raffles(id),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)),stock_limit INTEGER CHECK(stock_limit BETWEEN 0 AND 100000),
 issued_count INTEGER NOT NULL DEFAULT 0 CHECK(issued_count>=0),version INTEGER NOT NULL DEFAULT 0,
 created_by TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 CHECK((kind='credit' AND credit_cents>0 AND ticket_quantity=0 AND raffle_id IS NULL) OR (kind='raffle' AND credit_cents=0 AND ticket_quantity>0 AND raffle_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS reward_redemptions (
 id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),reward_id TEXT NOT NULL REFERENCES redemption_rewards(id),
 reward_name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('credit','raffle')),quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10),
 points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 1000000),credit_cents INTEGER NOT NULL CHECK(credit_cents BETWEEN 0 AND 500000),
 raffle_id TEXT REFERENCES reward_raffles(id),ticket_quantity INTEGER NOT NULL DEFAULT 0 CHECK(ticket_quantity BETWEEN 0 AND 1000),
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS redemption_member_history ON reward_redemptions(member_id,created_at DESC,id);
CREATE TABLE IF NOT EXISTS raffle_entries (
 id TEXT PRIMARY KEY,raffle_id TEXT NOT NULL REFERENCES reward_raffles(id),member_id TEXT REFERENCES members(id),visitor_name TEXT,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000),ticket_start INTEGER NOT NULL CHECK(ticket_start>0),ticket_end INTEGER NOT NULL,
 redemption_id TEXT UNIQUE REFERENCES reward_redemptions(id),created_by TEXT NOT NULL,created_at INTEGER NOT NULL,
 CHECK(ticket_end=ticket_start+quantity-1),CHECK((member_id IS NOT NULL AND visitor_name IS NULL) OR (member_id IS NULL AND length(visitor_name)>0)),
 UNIQUE(raffle_id,ticket_start),UNIQUE(raffle_id,ticket_end)
);
CREATE INDEX IF NOT EXISTS raffle_entry_member ON raffle_entries(member_id,created_at DESC);
CREATE TABLE IF NOT EXISTS raffle_draws (
 raffle_id TEXT PRIMARY KEY REFERENCES reward_raffles(id),entry_id TEXT NOT NULL REFERENCES raffle_entries(id),
 winning_ticket INTEGER NOT NULL,eligible_tickets INTEGER NOT NULL CHECK(eligible_tickets>0),
 method TEXT NOT NULL CHECK(method IN('internal','external')),request_id TEXT NOT NULL UNIQUE,drawn_by TEXT NOT NULL,drawn_at INTEGER NOT NULL,
 season_id TEXT REFERENCES reward_seasons(id),reason TEXT NOT NULL DEFAULT ''
);
CREATE TRIGGER IF NOT EXISTS redemption_no_update BEFORE UPDATE ON reward_redemptions BEGIN SELECT RAISE(ABORT,'Reward redemption history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS redemption_no_delete BEFORE DELETE ON reward_redemptions BEGIN SELECT RAISE(ABORT,'Reward redemption history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS raffle_entry_no_update BEFORE UPDATE ON raffle_entries BEGIN SELECT RAISE(ABORT,'Raffle tickets are immutable'); END;
CREATE TRIGGER IF NOT EXISTS raffle_entry_no_delete BEFORE DELETE ON raffle_entries BEGIN SELECT RAISE(ABORT,'Raffle tickets are immutable'); END;
CREATE TRIGGER IF NOT EXISTS raffle_draw_no_update BEFORE UPDATE ON raffle_draws BEGIN SELECT RAISE(ABORT,'Raffle draw results are final'); END;
CREATE TRIGGER IF NOT EXISTS raffle_draw_no_delete BEFORE DELETE ON raffle_draws BEGIN SELECT RAISE(ABORT,'Raffle draw results are final'); END;
