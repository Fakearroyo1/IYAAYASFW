-- Additive, rerunnable workflow release. No legacy balances, stock, identities,
-- reward records, receipts or closed snapshots are rewritten.
CREATE TABLE IF NOT EXISTS workflow_settings (
 id TEXT PRIMARY KEY CHECK(id='main'), price_fresh_days INTEGER NOT NULL DEFAULT 30 CHECK(price_fresh_days BETWEEN 1 AND 365),
 selected_run TEXT, version INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO workflow_settings(id) VALUES('main');
CREATE TABLE IF NOT EXISTS purchase_options (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), variant_id TEXT NOT NULL DEFAULT '',
 supplier TEXT NOT NULL, pack_label TEXT NOT NULL DEFAULT '', units_per_pack INTEGER NOT NULL CHECK(units_per_pack BETWEEN 1 AND 10000),
 pack_price INTEGER CHECK(pack_price>=0), price_at INTEGER, price_kind TEXT NOT NULL DEFAULT 'default' CHECK(price_kind IN('default','quote','purchase','derived')),
 source_id TEXT, preferred INTEGER NOT NULL DEFAULT 0 CHECK(preferred IN(0,1)), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), version INTEGER NOT NULL DEFAULT 0,
 UNIQUE(product_id,variant_id,supplier,units_per_pack)
);
CREATE UNIQUE INDEX IF NOT EXISTS preferred_purchase_option ON purchase_options(product_id,variant_id) WHERE preferred=1 AND active=1;
CREATE TABLE IF NOT EXISTS workflow_runs (
 run_id TEXT PRIMARY KEY REFERENCES restock_runs(id), stage TEXT NOT NULL CHECK(stage IN('planning','shopping','purchased','completed','cancelled')),
 estimated_charges INTEGER CHECK(estimated_charges>=0), estimated_discount INTEGER NOT NULL DEFAULT 0 CHECK(estimated_discount>=0),
 started_at INTEGER, completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS workflow_run_lines (
 line_id TEXT PRIMARY KEY REFERENCES restock_run_items(id), purchase_option_id TEXT REFERENCES purchase_options(id),
 planned_packs INTEGER NOT NULL CHECK(planned_packs BETWEEN 1 AND 10000), planned_pack_units INTEGER NOT NULL CHECK(planned_pack_units BETWEEN 1 AND 10000),
 planned_pack_price INTEGER CHECK(planned_pack_price>=0), price_source TEXT NOT NULL, price_at INTEGER, price_kind TEXT NOT NULL,
 supplier TEXT NOT NULL DEFAULT '', pack_label TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'needed' CHECK(state IN('needed','grabbed','skipped','purchased')),
 actual_packs INTEGER CHECK(actual_packs BETWEEN 1 AND 10000), actual_pack_units INTEGER CHECK(actual_pack_units BETWEEN 1 AND 10000),
 actual_pack_price INTEGER CHECK(actual_pack_price>=0), line_discount INTEGER NOT NULL DEFAULT 0 CHECK(line_discount>=0),
 note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS money_accounts (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'holding' CHECK(kind IN('holding','investment')), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), version INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO money_accounts(id,name) VALUES('cash','Cash'),('cashapp','Cash App');
CREATE TABLE IF NOT EXISTS purchase_receipts (
 id TEXT PRIMARY KEY, run_id TEXT REFERENCES restock_runs(id), expense_id TEXT NOT NULL UNIQUE REFERENCES expenses(id),
 supplier TEXT NOT NULL, reference TEXT NOT NULL, image TEXT, purchased_at INTEGER NOT NULL, created_at INTEGER NOT NULL, actor TEXT NOT NULL,
 funding TEXT NOT NULL CHECK(funding IN('activity','personal')), account_id TEXT REFERENCES money_accounts(id), purchaser TEXT,
 merchandise INTEGER NOT NULL CHECK(merchandise>=0), charges INTEGER NOT NULL CHECK(charges>=0), discount INTEGER NOT NULL CHECK(discount>=0),
 total INTEGER NOT NULL CHECK(total>=0 AND total=merchandise+charges-discount),
 CHECK((funding='activity' AND account_id IS NOT NULL AND purchaser IS NULL) OR (funding='personal' AND account_id IS NULL AND purchaser IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS purchase_lines (
 id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES purchase_receipts(id), run_line_id TEXT UNIQUE REFERENCES restock_run_items(id),
 product_id TEXT NOT NULL REFERENCES products(id), variant_id TEXT REFERENCES product_variants(id), purchase_option_id TEXT REFERENCES purchase_options(id),
 product_name TEXT NOT NULL, variant_label TEXT NOT NULL DEFAULT '', supplier TEXT NOT NULL,
 packs INTEGER NOT NULL CHECK(packs>0), units_per_pack INTEGER NOT NULL CHECK(units_per_pack>0), qty INTEGER NOT NULL CHECK(qty=packs*units_per_pack),
 pack_price INTEGER NOT NULL CHECK(pack_price>=0), line_discount INTEGER NOT NULL CHECK(line_discount>=0), allocated_charges INTEGER NOT NULL,
 total_cost INTEGER NOT NULL CHECK(total_cost>=0 AND total_cost=packs*pack_price-line_discount+allocated_charges),
 price_source TEXT NOT NULL, price_at INTEGER, received_qty INTEGER NOT NULL DEFAULT 0 CHECK(received_qty>=0 AND received_qty<=qty), version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS purchase_line_product ON purchase_lines(product_id,variant_id);
CREATE TABLE IF NOT EXISTS stock_receipt_links (
 id TEXT PRIMARY KEY, purchase_line_id TEXT NOT NULL REFERENCES purchase_lines(id), restock_entry_id TEXT UNIQUE REFERENCES restock_entries(id),
 qty INTEGER NOT NULL CHECK(qty>0), total_cost INTEGER NOT NULL CHECK(total_cost>=0), actor TEXT NOT NULL, created_at INTEGER NOT NULL,

-- Exact receipt allocation survives rounded legacy per-unit inventory costs.
 inventory_unit_cost INTEGER, rounding_remainder INTEGER
);
CREATE TABLE IF NOT EXISTS purchase_corrections (
 id TEXT PRIMARY KEY, purchase_line_id TEXT NOT NULL REFERENCES purchase_lines(id), kind TEXT NOT NULL CHECK(kind IN('return','damage')),
 qty INTEGER NOT NULL CHECK(qty>0), stock_qty INTEGER NOT NULL CHECK(stock_qty>=0 AND stock_qty<=qty),
 refund INTEGER NOT NULL CHECK(refund>=0), account_id TEXT REFERENCES money_accounts(id), reason TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS money_movements (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES money_accounts(id), amount INTEGER NOT NULL,
 category TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, effective_at INTEGER NOT NULL, posted_at INTEGER NOT NULL,
 effective_known INTEGER NOT NULL CHECK(effective_known IN(0,1)), actor TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', transfer_id TEXT,
 UNIQUE(source_type,source_id)
);
CREATE INDEX IF NOT EXISTS money_movements_account ON money_movements(account_id,effective_at,posted_at);
CREATE TABLE IF NOT EXISTS payment_receipt_times (
 payment_id TEXT PRIMARY KEY REFERENCES payments(id), effective_at INTEGER NOT NULL, known INTEGER NOT NULL CHECK(known IN(0,1))
);
CREATE TABLE IF NOT EXISTS money_observations (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES money_accounts(id), amount INTEGER NOT NULL CHECK(amount>=0),
 observed_at INTEGER NOT NULL, created_at INTEGER NOT NULL, actor TEXT NOT NULL, reviewer TEXT NOT NULL DEFAULT '',
 expected INTEGER, difference INTEGER, note TEXT NOT NULL DEFAULT '', ledger_complete INTEGER NOT NULL DEFAULT 0 CHECK(ledger_complete IN(0,1)),
 source_type TEXT NOT NULL DEFAULT 'check', source_id TEXT NOT NULL, UNIQUE(source_type,source_id)
);
CREATE INDEX IF NOT EXISTS money_observation_latest ON money_observations(account_id,observed_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS money_observation_coverage (
 observation_id TEXT NOT NULL REFERENCES money_observations(id), payment_id TEXT NOT NULL REFERENCES payments(id), PRIMARY KEY(observation_id,payment_id)
);
CREATE TABLE IF NOT EXISTS reimbursements (
 receipt_id TEXT PRIMARY KEY REFERENCES purchase_receipts(id), purchaser TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>=0)
);
CREATE TABLE IF NOT EXISTS reimbursement_settlements (
 id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES reimbursements(receipt_id), amount INTEGER NOT NULL CHECK(amount>0),
 account_id TEXT NOT NULL REFERENCES money_accounts(id), actor TEXT NOT NULL, created_at INTEGER NOT NULL, reference TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS money_commitments (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>=0), kind TEXT NOT NULL CHECK(kind IN('prepaid','tax','refund','supplier','other')),

-- One mutually exclusive grouping for funds backing the same obligation.
 group_key TEXT NOT NULL UNIQUE, run_id TEXT UNIQUE REFERENCES restock_runs(id), status TEXT NOT NULL CHECK(status IN('open','settled','cancelled')),
 version INTEGER NOT NULL DEFAULT 0, actor TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sale_cost_corrections (
 item_id TEXT PRIMARY KEY REFERENCES order_items(id), unit_cost INTEGER NOT NULL CHECK(unit_cost>=0), evidence TEXT NOT NULL,
 actor TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS accounting_money_snapshots (
 snapshot_id TEXT PRIMARY KEY REFERENCES accounting_snapshots(id), report TEXT NOT NULL
);
-- Historical cash counts are observations only, preserving source time/actor.
INSERT OR IGNORE INTO money_observations(id,account_id,amount,observed_at,created_at,actor,note,source_type,source_id)
 SELECT 'legacy-cash:'||id,'cash',json_extract(detail,'$.amount'),created_at,created_at,actor,
 COALESCE(json_extract(detail,'$.description'),''),'legacy-cashcount',id FROM audit
 WHERE kind='cashcount' AND json_valid(detail) AND json_type(detail,'$.amount')='integer' AND json_extract(detail,'$.amount')>=0;
-- Existing confirmed external payments have known account/amount, not a proven
-- arrival time. Keep that uncertainty; do not invent historical cash balances.
INSERT OR IGNORE INTO money_movements(id,account_id,amount,category,source_type,source_id,effective_at,posted_at,effective_known,actor,reference)
 SELECT 'payment:'||id,method,CASE WHEN purpose='refund' THEN -amount ELSE amount END,purpose,'payment',id,COALESCE(verified_at,created_at),COALESCE(verified_at,created_at),0,COALESCE(verified_by,'legacy'),COALESCE(reference,'') FROM payment_balances WHERE status='verified' AND method IN('cash','cashapp');
CREATE TRIGGER IF NOT EXISTS workflow_payment_insert AFTER INSERT ON payments WHEN NEW.status='verified' AND NEW.method IN('cash','cashapp') BEGIN
 INSERT INTO money_movements(id,account_id,amount,category,source_type,source_id,effective_at,posted_at,effective_known,actor,reference)
 VALUES('payment:'||NEW.id,NEW.method,CASE WHEN NEW.purpose='refund' THEN -NEW.amount ELSE NEW.amount END,NEW.purpose,'payment',NEW.id,COALESCE(NEW.verified_at,NEW.created_at),COALESCE(NEW.verified_at,NEW.created_at),1,COALESCE(NEW.verified_by,'system'),COALESCE(NEW.reference,''));
END;
CREATE TRIGGER IF NOT EXISTS workflow_payment_confirm AFTER UPDATE OF status ON payments WHEN OLD.status<>'verified' AND NEW.status='verified' AND NEW.method IN('cash','cashapp') BEGIN
 INSERT INTO money_movements(id,account_id,amount,category,source_type,source_id,effective_at,posted_at,effective_known,actor,reference)
 SELECT 'payment:'||NEW.id,NEW.method,CASE WHEN NEW.purpose='refund' THEN -amount ELSE amount END,NEW.purpose,'payment',NEW.id,
 COALESCE((SELECT effective_at FROM payment_receipt_times WHERE payment_id=NEW.id),NEW.verified_at),NEW.verified_at,
 COALESCE((SELECT known FROM payment_receipt_times WHERE payment_id=NEW.id),0),COALESCE(NEW.verified_by,'system'),COALESCE(NEW.reference,'') FROM payment_balances WHERE id=NEW.id;
END;
CREATE VIEW IF NOT EXISTS workflow_receipt_facts AS
 SELECT l.id,l.product_id,l.variant_id,l.qty,l.total_cost,r.reference,r.purchased_at created_at,r.actor,r.id receipt_id,r.run_id,
 l.packs,l.units_per_pack,l.pack_price,l.allocated_charges,l.supplier,l.received_qty,'purchase' source
 FROM purchase_lines l JOIN purchase_receipts r ON r.id=l.receipt_id
 UNION ALL SELECT e.id,e.product_id,e.variant_id,e.qty,e.total_cost,e.reference,e.created_at,e.actor,e.id,NULL,NULL,NULL,NULL,NULL,NULL,e.qty,'legacy'
 FROM restock_entries e WHERE NOT EXISTS(SELECT 1 FROM stock_receipt_links l WHERE l.restock_entry_id=e.id);
CREATE TRIGGER IF NOT EXISTS workflow_receipt_no_update BEFORE UPDATE ON purchase_receipts BEGIN SELECT RAISE(ABORT,'Posted receipts are immutable; record a correction'); END;
CREATE TRIGGER IF NOT EXISTS workflow_receipt_no_delete BEFORE DELETE ON purchase_receipts BEGIN SELECT RAISE(ABORT,'Posted receipts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_line_snapshot_immutable BEFORE UPDATE OF receipt_id,product_id,variant_id,packs,units_per_pack,qty,pack_price,line_discount,allocated_charges,total_cost,supplier ON purchase_lines BEGIN SELECT RAISE(ABORT,'Posted receipt lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_observation_no_update BEFORE UPDATE ON money_observations BEGIN SELECT RAISE(ABORT,'Balance checks are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_observation_no_delete BEFORE DELETE ON money_observations BEGIN SELECT RAISE(ABORT,'Balance checks are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_movement_no_update BEFORE UPDATE ON money_movements BEGIN SELECT RAISE(ABORT,'Money movements are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_movement_no_delete BEFORE DELETE ON money_movements BEGIN SELECT RAISE(ABORT,'Money movements are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_revision_money AFTER INSERT ON money_movements BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS workflow_revision_observation AFTER INSERT ON money_observations BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS workflow_money_snapshot_no_update BEFORE UPDATE ON accounting_money_snapshots BEGIN SELECT RAISE(ABORT,'Closed money reports are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_money_snapshot_no_delete BEFORE DELETE ON accounting_money_snapshots BEGIN SELECT RAISE(ABORT,'Closed money reports are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_revision_commitment_insert AFTER INSERT ON money_commitments BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS workflow_revision_commitment_update AFTER UPDATE ON money_commitments BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS workflow_revision_account_insert AFTER INSERT ON money_accounts BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS workflow_revision_account_update AFTER UPDATE ON money_accounts BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS workflow_revision_sale_cost AFTER INSERT ON sale_cost_corrections BEGIN UPDATE accounting_revision SET version=version+1 WHERE id='main'; END;
CREATE TRIGGER IF NOT EXISTS workflow_sale_cost_no_update BEFORE UPDATE ON sale_cost_corrections BEGIN SELECT RAISE(ABORT,'Cost corrections are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_sale_cost_no_delete BEFORE DELETE ON sale_cost_corrections BEGIN SELECT RAISE(ABORT,'Cost corrections are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_correction_no_update BEFORE UPDATE ON purchase_corrections BEGIN SELECT RAISE(ABORT,'Receipt corrections are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_correction_no_delete BEFORE DELETE ON purchase_corrections BEGIN SELECT RAISE(ABORT,'Receipt corrections are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_stock_link_no_update BEFORE UPDATE ON stock_receipt_links BEGIN SELECT RAISE(ABORT,'Receiving records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_stock_link_no_delete BEFORE DELETE ON stock_receipt_links BEGIN SELECT RAISE(ABORT,'Receiving records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_settlement_no_update BEFORE UPDATE ON reimbursement_settlements BEGIN SELECT RAISE(ABORT,'Reimbursement settlements are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_settlement_no_delete BEFORE DELETE ON reimbursement_settlements BEGIN SELECT RAISE(ABORT,'Reimbursement settlements are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_closed_movement BEFORE INSERT ON money_movements WHEN NOT EXISTS(SELECT 1 FROM money_movements WHERE id=NEW.id) AND EXISTS(SELECT 1 FROM accounting_periods WHERE month=strftime('%Y-%m',NEW.effective_at/1000,'unixepoch') AND status='closed') BEGIN SELECT RAISE(ABORT,'Reopen the accounting month before changing its money records'); END;
