-- Rounds 3–4. Additive and repeatable; no existing business records are changed.
CREATE TABLE IF NOT EXISTS email_change_requests (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), old_email TEXT NOT NULL,
 new_email TEXT NOT NULL COLLATE NOCASE, status TEXT NOT NULL CHECK(status IN('awaiting_verification','ready_for_review','access_sync_pending','completed','rejected','cancelled')),
 code_hash TEXT, code_expires_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
 verified_at INTEGER, approved_by TEXT, approved_at INTEGER, completed_at INTEGER,
 note TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_email_change ON email_change_requests(member_id) WHERE status IN('awaiting_verification','ready_for_review','access_sync_pending');
CREATE UNIQUE INDEX IF NOT EXISTS one_reserved_email ON email_change_requests(new_email) WHERE status IN('awaiting_verification','ready_for_review','access_sync_pending');
CREATE INDEX IF NOT EXISTS email_change_page ON email_change_requests(created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS member_email_history (
 id TEXT PRIMARY KEY REFERENCES email_change_requests(id), member_id TEXT NOT NULL REFERENCES members(id),
 old_email TEXT NOT NULL, new_email TEXT NOT NULL, actor TEXT NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_task_meta (
 task_key TEXT PRIMARY KEY, assignee TEXT REFERENCES members(id), state TEXT NOT NULL DEFAULT 'open' CHECK(state IN('open','in_progress','resolved')),
 due_at INTEGER, version INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_task_events (
 id TEXT PRIMARY KEY, task_key TEXT NOT NULL, actor TEXT NOT NULL REFERENCES members(id), kind TEXT NOT NULL,
 note TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS task_events_page ON admin_task_events(task_key,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS product_initiatives (
 id TEXT PRIMARY KEY, request_id TEXT UNIQUE REFERENCES item_requests(id), product_id TEXT NOT NULL UNIQUE REFERENCES products(id),
 kind TEXT NOT NULL CHECK(kind IN('trial','interest')), state TEXT NOT NULL CHECK(state IN('draft','open','kept','discontinued','preorder','closed')),
 note TEXT NOT NULL DEFAULT '', starts_at INTEGER, ends_at INTEGER NOT NULL, opening_qty INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 0, actor TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS initiatives_state_page ON product_initiatives(state,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS initiative_interest (
 initiative_id TEXT NOT NULL REFERENCES product_initiatives(id), member_id TEXT NOT NULL REFERENCES members(id),
 option_id TEXT NOT NULL DEFAULT '', option_label TEXT NOT NULL DEFAULT '', qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 20), updated_at INTEGER NOT NULL,
 PRIMARY KEY(initiative_id,member_id,option_id)
);
CREATE TABLE IF NOT EXISTS trial_feedback (
 initiative_id TEXT NOT NULL REFERENCES product_initiatives(id), member_id TEXT NOT NULL REFERENCES members(id),
 keep INTEGER NOT NULL CHECK(keep IN(0,1)), updated_at INTEGER NOT NULL, PRIMARY KEY(initiative_id,member_id)
);
CREATE TABLE IF NOT EXISTS initiative_losses (
 id TEXT PRIMARY KEY, initiative_id TEXT NOT NULL REFERENCES product_initiatives(id), variant_id TEXT,
 qty INTEGER NOT NULL CHECK(qty>0), unit_cost INTEGER, kind TEXT NOT NULL CHECK(kind IN('waste','shrink')),
 note TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS initiative_losses_date ON initiative_losses(initiative_id,created_at);
-- Source projections stay within the Worker SQLite compound-select limit.
CREATE VIEW IF NOT EXISTS operational_tasks_0(task_key,type,target,reference,title,person,amount,severity,created_at,due_at,active,destination,dismissible) AS
SELECT 'payment:'||p.id task_key,'payment' type,p.id target,COALESCE(o.code,'P-'||upper(substr(p.id,1,8))) reference,
 'Confirm payment' title,COALESCE(m.name,o.payer,'Guest') person,p.amount amount,
 CASE WHEN p.created_at<CAST(strftime('%s','now') AS INTEGER)*1000-172800000 THEN 'high' ELSE 'normal' END severity,
 p.created_at created_at,p.created_at+172800000 due_at,p.status='pending' active,'payments' destination,0 dismissible
 FROM payment_balances p LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN members m ON m.id=p.member_id
 UNION ALL SELECT 'tab:'||m.id,'tab',m.id,'TAB-'||upper(substr(m.id,1,8)),'Follow up on tab',m.name,m.debt,
 CASE WHEN m.debt>=COALESCE(c.tab_limit,3000) THEN 'high' ELSE 'normal' END,COALESCE(m.due_since,0),CASE WHEN m.due_since>0 THEN m.due_since+s.reminder_days*86400000 ELSE NULL END,
 m.active=1 AND m.debt>0 AND (m.debt>=2000 OR m.debt>=COALESCE(c.tab_limit,3000) OR m.due_since<CAST(strftime('%s','now') AS INTEGER)*1000-s.reminder_days*86400000),'members',0
 FROM members m LEFT JOIN member_controls c ON c.member_id=m.id JOIN settings s ON s.id='main'
 UNION ALL SELECT 'email:'||r.id,'email',r.id,'E-'||upper(substr(r.id,1,8)),'Email change',m.name,NULL,'high',r.created_at,NULL,r.status IN('awaiting_verification','ready_for_review','access_sync_pending'),'access',0 FROM email_change_requests r JOIN members m ON m.id=r.member_id;
CREATE VIEW IF NOT EXISTS operational_tasks_1(task_key,type,target,reference,title,person,amount,severity,created_at,due_at,active,destination,dismissible) AS
SELECT 'reset:'||r.id,'reset',r.member_id,'R-'||upper(substr(r.id,1,8)),'Password reset',m.name,NULL,'high',r.created_at,NULL,r.status='pending','members',0 FROM password_reset_requests r JOIN members m ON m.id=r.member_id
 UNION ALL SELECT 'stock:'||p.id,'stock',p.id,'STOCK-'||upper(substr(p.id,1,8)),'Low stock',p.name,p.stock,'normal',0,NULL,p.active=1 AND COALESCE(d.archived,0)=0 AND p.preorder=0 AND p.stock<=p.reorder AND NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id),'inventory',0 FROM products p LEFT JOIN product_details d ON d.product_id=p.id
 UNION ALL SELECT 'variant:'||v.id,'stock',p.id,'STOCK-'||upper(substr(v.id,1,8)),'Low option stock',p.name||' · '||v.label,v.stock,'normal',0,NULL,p.active=1 AND v.active=1 AND COALESCE(d.archived,0)=0 AND v.preorder=0 AND v.stock<=p.reorder,'inventory',0 FROM product_variants v JOIN products p ON p.id=v.product_id LEFT JOIN product_details d ON d.product_id=p.id;
CREATE VIEW IF NOT EXISTS operational_tasks_2(task_key,type,target,reference,title,person,amount,severity,created_at,due_at,active,destination,dismissible) AS
SELECT 'report:'||r.id task_key,'report' type,r.id target,'REPORT-'||upper(substr(r.id,1,8)) reference,'Moderation report' title,r.kind person,NULL amount,'high' severity,r.created_at created_at,NULL due_at,r.status='open' active,'community' destination,0 dismissible FROM community_reports r
 UNION ALL SELECT 'request:'||r.id,'request',r.id,'REQ-'||upper(substr(r.id,1,8)),'Review item request',r.title,NULL,'normal',r.created_at,NULL,r.removed=0 AND r.status='open','requests',0 FROM item_requests r
 UNION ALL SELECT 'team:'||t.id,'team',t.id,'TEAM-'||upper(substr(t.id,1,8)),t.title,m.name,NULL,'normal',t.created_at,NULL,t.kind='question' AND t.status='open' AND t.removed=0,'team',0 FROM team_messages t JOIN members m ON m.id=t.actor;
CREATE VIEW IF NOT EXISTS operational_tasks_3(task_key,type,target,reference,title,person,amount,severity,created_at,due_at,active,destination,dismissible) AS
SELECT 'pickup:'||i.id,'pickup',o.id,o.code,'Gear fulfillment',o.payer||' · '||i.name,NULL,CASE WHEN i.fulfillment_updated_at<CAST(strftime('%s','now') AS INTEGER)*1000-604800000 THEN 'high' ELSE 'normal' END,o.created_at,COALESCE(i.fulfillment_updated_at,o.created_at)+604800000,o.status='paid' AND i.remaining_qty>0 AND COALESCE(i.fulfillment,'untracked')<>'fulfilled','pickups',0 FROM item_balances i JOIN orders o ON o.id=i.order_id WHERE i.category='Gear' AND i.custom=0
 UNION ALL SELECT 'trial:'||i.id,'trial',i.id,'TRIAL-'||upper(substr(i.id,1,8)),'Review product trial',p.name,NULL,'normal',i.created_at,i.ends_at,i.state='open' AND i.ends_at<=CAST(strftime('%s','now') AS INTEGER)*1000,'trials',0 FROM product_initiatives i JOIN products p ON p.id=i.product_id
 UNION ALL SELECT 'adjustment:'||a.id,'adjustment',a.target,'A-'||upper(substr(a.id,1,8)),'Review adjustment',a.kind,NULL,'normal',a.created_at,NULL,1,'activity',1 FROM audit a WHERE a.kind IN('stock_adjusted','option_stock_adjusted','purchase_corrected','trial_stock_loss') OR (a.kind='member_updated' AND (COALESCE(json_extract(a.detail,'$.before.debt'),0)<>COALESCE(json_extract(a.detail,'$.after.debt'),0) OR COALESCE(json_extract(a.detail,'$.before.credit'),0)<>COALESCE(json_extract(a.detail,'$.after.credit'),0)));
CREATE VIEW IF NOT EXISTS operational_tasks AS SELECT * FROM operational_tasks_0 UNION ALL SELECT * FROM operational_tasks_1 UNION ALL SELECT * FROM operational_tasks_2 UNION ALL SELECT * FROM operational_tasks_3;
