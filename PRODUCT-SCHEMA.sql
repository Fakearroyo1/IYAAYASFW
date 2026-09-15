-- Additive only. No existing records, prices, balances, or counts are rewritten.
CREATE TABLE IF NOT EXISTS member_access (
 member_id TEXT PRIMARY KEY REFERENCES members(id), snacks INTEGER NOT NULL DEFAULT 1 CHECK(snacks IN(0,1)), gear INTEGER NOT NULL DEFAULT 1 CHECK(gear IN(0,1))
);
CREATE TABLE IF NOT EXISTS auth_setup (
 member_id TEXT PRIMARY KEY REFERENCES members(id), code_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS password_reset_requests (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','resolved')), created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_password_reset ON password_reset_requests(member_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS product_details (
 product_id TEXT PRIMARY KEY REFERENCES products(id), description TEXT NOT NULL DEFAULT '', images TEXT NOT NULL DEFAULT '[]', personalization_label TEXT NOT NULL DEFAULT '', personalization_required INTEGER NOT NULL DEFAULT 0, personalization_max INTEGER NOT NULL DEFAULT 30, pickup_note TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)), version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS product_variants (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), label TEXT NOT NULL, size TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '', price INTEGER CHECK(price IS NULL OR price>0), cost INTEGER CHECK(cost IS NULL OR cost>=0), stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), preorder INTEGER NOT NULL DEFAULT 0 CHECK(preorder IN(0,1)), version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS variants_product ON product_variants(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS variant_label_unique ON product_variants(product_id,label);
CREATE TABLE IF NOT EXISTS order_item_details (
 item_id TEXT PRIMARY KEY REFERENCES order_items(id), variant_id TEXT REFERENCES product_variants(id), variant_label TEXT NOT NULL DEFAULT '', personalization TEXT NOT NULL DEFAULT '', fulfillment TEXT NOT NULL CHECK(fulfillment IN('awaiting_stock','ready','fulfilled')), updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS restock_entries (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), variant_id TEXT REFERENCES product_variants(id), qty INTEGER NOT NULL CHECK(qty>0), total_cost INTEGER NOT NULL CHECK(total_cost>0), reference TEXT NOT NULL, created_at INTEGER NOT NULL, actor TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS restock_product ON restock_entries(product_id,created_at);
