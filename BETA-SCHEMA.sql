-- Additive, repeatable release migration. Original sales, payments, stock and
-- member balances stay intact. New views apply explicitly recorded corrections.
CREATE TABLE IF NOT EXISTS member_controls (
 member_id TEXT PRIMARY KEY REFERENCES members(id),
 tab_limit INTEGER NOT NULL DEFAULT 3000 CHECK(tab_limit BETWEEN 0 AND 3000),
 posting_enabled INTEGER NOT NULL DEFAULT 1 CHECK(posting_enabled IN(0,1)),
 version INTEGER NOT NULL DEFAULT 0
);
-- The previous default was $20. Preserve stricter individual limits.
INSERT OR IGNORE INTO member_controls(member_id,tab_limit)
 SELECT id,CASE WHEN tab_limit=2000 THEN 3000 ELSE MIN(tab_limit,3000) END FROM members;
CREATE TABLE IF NOT EXISTS balance_ledger (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
 order_id TEXT REFERENCES orders(id), payment_id TEXT REFERENCES payments(id),
 kind TEXT NOT NULL, debt_delta INTEGER NOT NULL, credit_delta INTEGER NOT NULL,
 actor TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_member_page ON balance_ledger(member_id,created_at DESC,id DESC);
INSERT OR IGNORE INTO balance_ledger(id,member_id,kind,debt_delta,credit_delta,actor,note,created_at)
 SELECT 'opening:'||id,id,'opening',debt,credit,'migration','Balance carried forward; no funds changed.',CAST(strftime('%s','now') AS INTEGER)*1000 FROM members m WHERE NOT EXISTS(SELECT 1 FROM balance_ledger l WHERE l.member_id=m.id);
CREATE TABLE IF NOT EXISTS order_funding (
 order_id TEXT PRIMARY KEY REFERENCES orders(id),
 credit_used INTEGER NOT NULL CHECK(credit_used>=0),
 tab_added INTEGER NOT NULL CHECK(tab_added>=0),
 cash_due INTEGER NOT NULL CHECK(cash_due>=0)
);
CREATE TABLE IF NOT EXISTS custom_order_items (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
 name TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN('Snacks','Gear')),
 qty INTEGER NOT NULL CHECK(qty>0), price INTEGER NOT NULL CHECK(price>0),
 cost INTEGER CHECK(cost IS NULL OR cost>=0), tax_bp INTEGER NOT NULL CHECK(tax_bp BETWEEN 0 AND 3000)
);
CREATE INDEX IF NOT EXISTS custom_items_order ON custom_order_items(order_id);
CREATE TABLE IF NOT EXISTS transaction_adjustments (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
 actor TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
 total INTEGER NOT NULL CHECK(total>0), tax INTEGER NOT NULL CHECK(tax>=0), cost INTEGER,
 debt_reduced INTEGER NOT NULL DEFAULT 0 CHECK(debt_reduced>=0),
 credit_returned INTEGER NOT NULL DEFAULT 0 CHECK(credit_returned>=0),
 pending_reduced INTEGER NOT NULL DEFAULT 0 CHECK(pending_reduced>=0),
 external_refund INTEGER NOT NULL DEFAULT 0 CHECK(external_refund>=0),
 refund_method TEXT NOT NULL,
 CHECK(total=debt_reduced+credit_returned+pending_reduced+external_refund)
);
CREATE INDEX IF NOT EXISTS adjustments_order ON transaction_adjustments(order_id);
CREATE TABLE IF NOT EXISTS transaction_adjustment_items (
 adjustment_id TEXT NOT NULL REFERENCES transaction_adjustments(id),
 item_id TEXT NOT NULL, qty INTEGER NOT NULL CHECK(qty>0),
 restock INTEGER NOT NULL CHECK(restock IN(0,1)),
 PRIMARY KEY(adjustment_id,item_id)
);
CREATE INDEX IF NOT EXISTS adjustments_item ON transaction_adjustment_items(item_id);
CREATE TABLE IF NOT EXISTS payment_confirmations (
 payment_id TEXT PRIMARY KEY REFERENCES payments(id),
 received_amount INTEGER NOT NULL CHECK(received_amount>0),
 debt_applied INTEGER NOT NULL DEFAULT 0 CHECK(debt_applied>=0),
 credit_added INTEGER NOT NULL DEFAULT 0 CHECK(credit_added>=0)
);
CREATE VIEW IF NOT EXISTS order_balances AS
 SELECT o.id,o.code,o.fingerprint,o.member_id,o.payer,o.method,o.created_at,o.status,
 o.total original_total,o.tax original_tax,o.cost original_cost,
 o.total-COALESCE(a.total,0) total,o.tax-COALESCE(a.tax,0) tax,
 CASE WHEN o.cost IS NULL THEN NULL ELSE o.cost-COALESCE(a.cost,0) END cost,
 COALESCE(a.total,0) adjusted_total,COALESCE(a.revision,0) revision,
 COALESCE(f.credit_used,CASE WHEN o.method='credit' THEN o.total ELSE 0 END) credit_used,
 COALESCE(f.tab_added,CASE WHEN o.method='tab' THEN o.total ELSE 0 END) tab_added,
 COALESCE(f.cash_due,CASE WHEN o.method IN('cash','cashapp') THEN o.total ELSE 0 END) cash_due,
 COALESCE(a.pending_reduced,0) pending_reduced,COALESCE(a.debt_reduced,0) debt_reduced
 FROM orders o LEFT JOIN order_funding f ON f.order_id=o.id
 LEFT JOIN (SELECT order_id,SUM(total) total,SUM(tax) tax,SUM(cost) cost,
 SUM(pending_reduced) pending_reduced,SUM(debt_reduced) debt_reduced,COUNT(*) revision
 FROM transaction_adjustments GROUP BY order_id) a ON a.order_id=o.id;
CREATE VIEW IF NOT EXISTS sale_lines AS
 SELECT i.id,i.order_id,i.product_id,i.name,p.category,i.qty,i.price,i.cost,i.tax_bp,i.preorder,
 d.variant_id,d.variant_label,d.personalization,d.fulfillment,d.updated_at fulfillment_updated_at,0 custom
 FROM order_items i JOIN products p ON p.id=i.product_id LEFT JOIN order_item_details d ON d.item_id=i.id
 UNION ALL SELECT id,order_id,NULL,name,category,qty,price,cost,tax_bp,0,NULL,'','',NULL,NULL,1 FROM custom_order_items;
CREATE VIEW IF NOT EXISTS item_balances AS
 SELECT i.*,i.qty-COALESCE(a.qty,0) remaining_qty,
 COALESCE(a.qty,0) corrected_qty,
 ROUND(i.price*i.qty*i.tax_bp*1.0/(10000+i.tax_bp))-ROUND(i.price*COALESCE(a.qty,0)*i.tax_bp*1.0/(10000+i.tax_bp)) remaining_tax
 FROM sale_lines i LEFT JOIN (SELECT item_id,SUM(qty) qty FROM transaction_adjustment_items GROUP BY item_id) a ON a.item_id=i.id;
CREATE VIEW IF NOT EXISTS payment_balances AS
 SELECT p.id,p.fingerprint,p.order_id,p.member_id,p.purpose,p.method,p.status,p.reference,p.verified_by,p.created_at,p.verified_at,
 p.amount original_amount,
 CASE WHEN p.status='verified' THEN COALESCE(c.received_amount,p.amount)
 WHEN p.purpose='purchase' THEN MAX(0,p.amount-COALESCE(o.pending_reduced,0)) ELSE p.amount END amount,
 COALESCE(c.debt_applied,CASE WHEN p.status='verified' AND p.purpose='settlement' THEN p.amount ELSE 0 END) debt_applied,
 COALESCE(c.credit_added,CASE WHEN p.status='verified' AND p.purpose='topup' THEN p.amount ELSE 0 END) credit_added
 FROM payments p LEFT JOIN payment_confirmations c ON c.payment_id=p.id LEFT JOIN order_balances o ON o.id=p.order_id;

CREATE TABLE IF NOT EXISTS item_requests (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
 shop TEXT NOT NULL CHECK(shop IN('snacks','gear')), title TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','accepted','denied')),
 decision_note TEXT NOT NULL DEFAULT '', removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN(0,1)),
 version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_shop_page ON item_requests(shop,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS requests_member_date ON item_requests(member_id,created_at);
CREATE TABLE IF NOT EXISTS request_votes (
 request_id TEXT NOT NULL REFERENCES item_requests(id), member_id TEXT NOT NULL REFERENCES members(id),
 value INTEGER NOT NULL CHECK(value IN(-1,1)), updated_at INTEGER NOT NULL,
 PRIMARY KEY(request_id,member_id)
);
CREATE TABLE IF NOT EXISTS product_reviews (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), member_id TEXT NOT NULL REFERENCES members(id),
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), body TEXT NOT NULL DEFAULT '',
 removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN(0,1)), version INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(product_id,member_id)
);
CREATE INDEX IF NOT EXISTS reviews_product_page ON product_reviews(product_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS reviews_member_date ON product_reviews(member_id,created_at);
CREATE TABLE IF NOT EXISTS community_reports (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
 kind TEXT NOT NULL CHECK(kind IN('request','review')), target TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved')), created_at INTEGER NOT NULL,
 UNIQUE(member_id,kind,target)
);
CREATE INDEX IF NOT EXISTS reports_open ON community_reports(status,created_at);
CREATE TABLE IF NOT EXISTS team_messages (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES members(id),
 title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN('note','question')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved')),
 pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN(0,1)), removed INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS team_messages_page ON team_messages(created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS team_replies (
 id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES team_messages(id), actor TEXT NOT NULL REFERENCES members(id),
 body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS team_replies_message ON team_replies(message_id,created_at,id);
