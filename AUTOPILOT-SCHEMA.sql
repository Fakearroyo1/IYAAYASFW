-- Additive inventory planning and immutable period snapshots.
CREATE TABLE IF NOT EXISTS inventory_plans (
 product_id TEXT NOT NULL REFERENCES products(id),option_id TEXT NOT NULL DEFAULT '',vendor TEXT NOT NULL DEFAULT '',
 pack_size INTEGER NOT NULL DEFAULT 1 CHECK(pack_size BETWEEN 1 AND 1000),lead_days INTEGER NOT NULL DEFAULT 7 CHECK(lead_days BETWEEN 0 AND 90),
 target_days INTEGER NOT NULL DEFAULT 21 CHECK(target_days BETWEEN 1 AND 180),safety_units INTEGER NOT NULL DEFAULT 2 CHECK(safety_units BETWEEN 0 AND 10000),
 version INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(product_id,option_id)
);
CREATE TABLE IF NOT EXISTS restock_runs (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('shopping','received','cancelled')) DEFAULT 'shopping',
 version INTEGER NOT NULL DEFAULT 0,actor TEXT NOT NULL,created_at INTEGER NOT NULL,received_at INTEGER,receipt TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS restock_run_items (
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES restock_runs(id),product_id TEXT NOT NULL REFERENCES products(id),option_id TEXT NOT NULL DEFAULT '',
 suggested_qty INTEGER NOT NULL,qty INTEGER NOT NULL CHECK(qty BETWEEN 0 AND 10000),total_cost INTEGER CHECK(total_cost>=0),
 checked INTEGER NOT NULL DEFAULT 0 CHECK(checked IN(0,1)),override_reason TEXT NOT NULL DEFAULT '',vendor TEXT NOT NULL DEFAULT '',
 UNIQUE(run_id,product_id,option_id)
);
CREATE TABLE IF NOT EXISTS count_sessions (
 id TEXT PRIMARY KEY,actor TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','completed','cancelled')),version INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS inventory_counts (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES count_sessions(id),product_id TEXT NOT NULL REFERENCES products(id),option_id TEXT NOT NULL DEFAULT '',
 expected INTEGER NOT NULL,product_version INTEGER NOT NULL,option_version INTEGER NOT NULL,cost INTEGER,
 actual INTEGER,variance INTEGER,kind TEXT CHECK(kind IN('matched','explained','unexplained','waste','damage')),reason TEXT NOT NULL DEFAULT '',
 UNIQUE(session_id,product_id,option_id)
);
CREATE INDEX IF NOT EXISTS count_item_history ON inventory_counts(product_id,option_id,session_id);
CREATE TABLE IF NOT EXISTS accounting_periods (
 month TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN('open','closed')),version INTEGER NOT NULL DEFAULT 0,current_snapshot TEXT
);
CREATE TABLE IF NOT EXISTS accounting_snapshots (
 id TEXT PRIMARY KEY,month TEXT NOT NULL REFERENCES accounting_periods(month),actor TEXT NOT NULL,created_at INTEGER NOT NULL,
 report TEXT NOT NULL,checklist TEXT NOT NULL,note TEXT NOT NULL,cash_on_hand INTEGER NOT NULL CHECK(cash_on_hand>=0),cashapp_reference TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounting_events(id TEXT PRIMARY KEY,month TEXT NOT NULL,kind TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS accounting_snapshot_no_update BEFORE UPDATE ON accounting_snapshots BEGIN SELECT RAISE(ABORT,'Closed reports are immutable'); END;
CREATE TRIGGER IF NOT EXISTS accounting_snapshot_no_delete BEFORE DELETE ON accounting_snapshots BEGIN SELECT RAISE(ABORT,'Closed reports are immutable'); END;
CREATE TRIGGER IF NOT EXISTS closed_order_correction BEFORE INSERT ON transaction_adjustments WHEN EXISTS(SELECT 1 FROM orders o JOIN accounting_periods p ON p.month=strftime('%Y-%m',o.created_at/1000,'unixepoch') WHERE o.id=NEW.order_id AND p.status='closed') BEGIN SELECT RAISE(ABORT,'Reopen the accounting month before correcting this order'); END;
CREATE TRIGGER IF NOT EXISTS closed_order_update BEFORE UPDATE OF status,total,tax,cost ON orders WHEN EXISTS(SELECT 1 FROM accounting_periods WHERE month=strftime('%Y-%m',OLD.created_at/1000,'unixepoch') AND status='closed') BEGIN SELECT RAISE(ABORT,'Reopen the accounting month before changing this order'); END;
CREATE TRIGGER IF NOT EXISTS closed_payment_update BEFORE UPDATE OF status,amount ON payments WHEN EXISTS(SELECT 1 FROM accounting_periods WHERE month=strftime('%Y-%m',OLD.created_at/1000,'unixepoch') AND status='closed') BEGIN SELECT RAISE(ABORT,'Reopen the accounting month before changing this payment'); END;
CREATE TRIGGER IF NOT EXISTS closed_expense_update BEFORE UPDATE ON expenses WHEN EXISTS(SELECT 1 FROM accounting_periods WHERE month=strftime('%Y-%m',OLD.created_at/1000,'unixepoch') AND status='closed') BEGIN SELECT RAISE(ABORT,'Reopen the accounting month before changing this expense'); END;
CREATE TRIGGER IF NOT EXISTS closed_expense_delete BEFORE DELETE ON expenses WHEN EXISTS(SELECT 1 FROM accounting_periods WHERE month=strftime('%Y-%m',OLD.created_at/1000,'unixepoch') AND status='closed') BEGIN SELECT RAISE(ABORT,'Reopen the accounting month before deleting this expense'); END;

CREATE TABLE IF NOT EXISTS accounting_revision(id TEXT PRIMARY KEY CHECK(id='main'),version INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO accounting_revision(id) VALUES('main');
CREATE TRIGGER IF NOT EXISTS accounting_rev_orders_insert AFTER INSERT ON orders BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS accounting_rev_orders_update AFTER UPDATE ON orders BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS accounting_rev_payments_insert AFTER INSERT ON payments BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS accounting_rev_payments_update AFTER UPDATE ON payments BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS accounting_rev_transaction_adjustments_insert AFTER INSERT ON transaction_adjustments BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS accounting_rev_expenses_insert AFTER INSERT ON expenses BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS accounting_rev_expenses_update AFTER UPDATE ON expenses BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS accounting_rev_expenses_delete AFTER DELETE ON expenses BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS accounting_rev_members_update AFTER UPDATE ON members BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS accounting_rev_count_sessions_update AFTER UPDATE ON count_sessions BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS accounting_rev_inventory_counts_update AFTER UPDATE ON inventory_counts BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
