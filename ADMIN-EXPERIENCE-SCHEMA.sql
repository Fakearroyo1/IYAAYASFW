-- Additive workflow metadata only. No financial, inventory, or member records change.
CREATE TABLE IF NOT EXISTS admin_task_snoozes (
 task_key TEXT PRIMARY KEY, until_at INTEGER NOT NULL, source_snapshot TEXT NOT NULL,
 actor TEXT NOT NULL REFERENCES members(id), updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_task_batches (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES members(id), operation TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_task_batch_items (
 batch_id TEXT NOT NULL REFERENCES admin_task_batches(id), task_key TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN('applied','skipped')), PRIMARY KEY(batch_id,task_key)
);
