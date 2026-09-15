-- Additive security metadata and query indexes only. Never reset business data.
CREATE TABLE IF NOT EXISTS auth_admin_access (
 token_hash TEXT PRIMARY KEY REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
 subject TEXT NOT NULL, verified_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_access_expiry ON auth_admin_access(expires_at);
CREATE TABLE IF NOT EXISTS auth_recovery (
 member_id TEXT PRIMARY KEY REFERENCES members(id), code_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_member_page ON orders(member_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS orders_page ON orders(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS payments_member_page ON payments(member_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS payments_page ON payments(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS payments_status_page ON payments(status,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS items_product_order ON order_items(product_id,order_id);
CREATE INDEX IF NOT EXISTS audit_page ON audit(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS audit_target_page ON audit(target,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS expenses_page ON expenses(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS limits_expiry_cleanup ON auth_limits(expires_at);
