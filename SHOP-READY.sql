-- One-time cutover correction requested when moving the prepared store out of pilot setup.
-- Preserve prices, stock, balances, credentials, and payment instructions.
-- Record the marker even for an unconfigured store: future deploys must never
-- reopen a shop that an administrator has deliberately paused.
INSERT INTO audit(id,actor,kind,target,detail,created_at)
SELECT 'shop-ready-20260914', 'system', 'checkout_opened', 'main',
       '{"reason":"Open the configured shop after Cloudflare cutover","enabled":1}',
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM settings
WHERE id='main' AND enabled=0
  AND NOT EXISTS(SELECT 1 FROM mutations WHERE id='shop-ready-20260914')
  AND EXISTS(SELECT 1 FROM products WHERE active=1 AND price>0 AND tax_bp IS NOT NULL AND (preorder=1 OR stock>0));

UPDATE settings SET enabled=1
WHERE id='main' AND enabled=0
  AND NOT EXISTS(SELECT 1 FROM mutations WHERE id='shop-ready-20260914')
  AND EXISTS(SELECT 1 FROM products WHERE active=1 AND price>0 AND tax_bp IS NOT NULL AND (preorder=1 OR stock>0));

INSERT OR IGNORE INTO mutations(id,fingerprint) VALUES('shop-ready-20260914','open-configured-shop-v1');
