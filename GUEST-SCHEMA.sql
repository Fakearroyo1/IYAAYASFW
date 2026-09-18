-- Additive guest gear metadata. Existing orders, stock and members are preserved.
CREATE TABLE IF NOT EXISTS guest_settings (
 id TEXT PRIMARY KEY CHECK(id='main'), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 version INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO guest_settings(id) VALUES('main');
CREATE TABLE IF NOT EXISTS gear_delivery (
 product_id TEXT NOT NULL REFERENCES products(id), option_id TEXT NOT NULL DEFAULT '',
 pickup INTEGER NOT NULL DEFAULT 1 CHECK(pickup IN(0,1)), shipping INTEGER NOT NULL DEFAULT 0 CHECK(shipping IN(0,1)),
 first_charge INTEGER NOT NULL DEFAULT 0 CHECK(first_charge>=0), additional_charge INTEGER NOT NULL DEFAULT 0 CHECK(additional_charge>=0),
 version INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(product_id,option_id)
);
CREATE TABLE IF NOT EXISTS guest_campaigns (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)),
 code_hash TEXT UNIQUE, code_version INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0,
 reservation_hours INTEGER NOT NULL DEFAULT 24 CHECK(reservation_hours BETWEEN 1 AND 72),
 shipping_cap INTEGER CHECK(shipping_cap>=0), free_shipping_threshold INTEGER CHECK(free_shipping_threshold>0),
 shipping_tax_bp INTEGER NOT NULL DEFAULT 0 CHECK(shipping_tax_bp BETWEEN 0 AND 3000),
 pickup_note TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK(ends_at>starts_at)
);
CREATE TABLE IF NOT EXISTS guest_campaign_items (
 campaign_id TEXT NOT NULL REFERENCES guest_campaigns(id), product_id TEXT NOT NULL REFERENCES products(id), option_id TEXT NOT NULL DEFAULT '',
 quantity_limit INTEGER NOT NULL CHECK(quantity_limit BETWEEN 1 AND 10000), PRIMARY KEY(campaign_id,product_id,option_id)
);
CREATE TABLE IF NOT EXISTS guest_sessions (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES guest_campaigns(id), code_version INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guest_session_expiry ON guest_sessions(expires_at);
CREATE TABLE IF NOT EXISTS guest_orders (
 order_id TEXT PRIMARY KEY REFERENCES orders(id), campaign_id TEXT NOT NULL REFERENCES guest_campaigns(id), session_id TEXT NOT NULL,
 email TEXT NOT NULL, receipt_hash TEXT NOT NULL, delivery TEXT NOT NULL CHECK(delivery IN('pickup','shipping')),
 address TEXT, shipping_amount INTEGER NOT NULL CHECK(shipping_amount>=0),
 state TEXT NOT NULL DEFAULT 'payment_pending' CHECK(state IN('payment_pending','paid','ready_for_pickup','packing','shipped','picked_up','completed','cancelled','expired')),
 reservation_expires INTEGER NOT NULL, carrier TEXT NOT NULL DEFAULT '', tracking TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK((delivery='pickup' AND address IS NULL AND shipping_amount=0) OR delivery='shipping')
);
CREATE INDEX IF NOT EXISTS guest_orders_campaign ON guest_orders(campaign_id,created_at DESC,order_id);
CREATE INDEX IF NOT EXISTS guest_orders_session ON guest_orders(session_id,created_at DESC);
CREATE INDEX IF NOT EXISTS guest_orders_pending ON guest_orders(state,reservation_expires);
CREATE TABLE IF NOT EXISTS guest_order_events (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), actor TEXT NOT NULL,
 kind TEXT NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guest_events_order ON guest_order_events(order_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS guest_paid AFTER UPDATE OF status ON orders
 WHEN NEW.status='paid' AND OLD.status='pending'
 BEGIN UPDATE guest_orders SET state='paid',version=version+1,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE order_id=NEW.id AND state='payment_pending'; END;
CREATE TRIGGER IF NOT EXISTS guest_void AFTER UPDATE OF status ON orders
 WHEN NEW.status='void' AND OLD.status<>'void'
 BEGIN UPDATE guest_orders SET state='cancelled',version=version+1,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE order_id=NEW.id AND state NOT IN('cancelled','expired'); END;
