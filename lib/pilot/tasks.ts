import { type DB, type Row, fail, str, int, first, rows, stmt, audit, guard, hash } from './core';
import { operation, noteText } from './operation';
const sourceSnapshot = `json_array(t.type,t.target,t.reference,t.title,t.person,t.amount,t.severity,t.created_at,t.due_at,t.active,t.dismissible)`;
const tasksSQL = `SELECT t.*,m.assignee,m.state work_state,COALESCE(m.version,-1) version,
 COALESCE(m.due_at,t.due_at) deadline,${sourceSnapshot} source_snapshot,
 CASE WHEN s.until_at>CAST(strftime('%s','now') AS INTEGER)*1000 AND s.source_snapshot=${sourceSnapshot} AND t.active=1 THEN s.until_at ELSE NULL END snoozed_until,
 CASE WHEN t.active=0 OR(t.dismissible=1 AND m.state='resolved') THEN 'resolved' ELSE COALESCE(NULLIF(m.state,'resolved'),'open') END status
 FROM operational_tasks t LEFT JOIN admin_task_meta m ON m.task_key=t.task_key LEFT JOIN admin_task_snoozes s ON s.task_key=t.task_key`;
const revision = (t: Row) => hash({ source: t.source_snapshot, version: t.version });
const routineNote = (v: unknown, fallback: string) => v == null || (typeof v === 'string' && !v.trim()) ? fallback : noteText(v, 1000, 1);
async function decorate(t: Row) { const { source_snapshot, ...publicTask } = t; return { ...publicTask, revision: await revision(t) }; }
export async function taskPage(db: DB, m: Row, q: Row) {
 if (m.role !== 'admin') fail('Verified administrator access is required.', 403);
 const filter = q.filter || 'open', search = str(q.search || '', 100), offset = int(Number(q.offset || 0), 0, 100000);
 if (!['open','resolved','mine','all','snoozed'].includes(filter)) fail('Choose a supported task view.');
 const where = [filter === 'open' ? "status<>'resolved' AND snoozed_until IS NULL" : filter === 'resolved' ? "status='resolved'" : filter === 'mine' ? "assignee=? AND status<>'resolved' AND snoozed_until IS NULL" : filter === 'snoozed' ? "status<>'resolved' AND snoozed_until IS NOT NULL" : '1=1'], args: any[] = filter === 'mine' ? [m.id] : [];
 if (search) { where.push('(instr(lower(title),lower(?))>0 OR instr(lower(person),lower(?))>0 OR instr(lower(reference),lower(?))>0)'); args.push(search, search, search); }
 if (q.type) { const types=[...new Set(str(q.type,250).split(','))]; const allowed=['payment','tab','email','reset','stock','report','request','team','pickup','trial','adjustment','guest','profile','profile-report']; if(types.some(t=>!allowed.includes(t))) fail('Choose a supported task type.'); where.push('type IN ('+types.map(()=>'?').join(',')+')'); args.push(...types); }
 const records = await rows(db, `SELECT * FROM (${tasksSQL}) WHERE ${where.join(' AND ')} ORDER BY CASE severity WHEN 'high' THEN 0 ELSE 1 END,created_at DESC,task_key LIMIT 51 OFFSET ?`, ...args, offset);
 // Counts include snoozed obligations; a reminder is not settlement or fulfillment.
 const counts = await rows(db, `SELECT type,COUNT(*) count FROM (${tasksSQL}) WHERE status<>'resolved' GROUP BY type`);
 const now = Date.now(), today = Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth(),new Date(now).getUTCDate());
 const brief = await first(db, "SELECT (SELECT COALESCE(SUM(total),0) FROM order_balances WHERE status IN('paid','tab') AND created_at>=? AND created_at<?) yesterday_sales,(SELECT COALESCE(SUM(debt),0) FROM members) outstanding_tabs,(SELECT COUNT(*) FROM payments WHERE status='pending') pending_payments", today-86400000, today);
 const admins = await rows(db, "SELECT id,name FROM members WHERE active=1 AND role='admin' ORDER BY name,id");
 let task = null, events: Row[] = [];
 if (q.taskKey) { const raw = await first(db, `SELECT * FROM (${tasksSQL}) WHERE task_key=?`, str(q.taskKey,140)); if (raw) { task = await decorate(raw); events = await rows(db,'SELECT e.*,m.name actor_name FROM admin_task_events e JOIN members m ON m.id=e.actor WHERE task_key=? ORDER BY created_at DESC,id DESC LIMIT 100',raw.task_key); } }
 return { records: await Promise.all(records.slice(0,50).map(decorate)), nextOffset: records.length>50 ? offset+50 : null, counts, brief, admins, task, events };
}
async function bulkResult(db: DB, id: string) {
 const results = await rows(db, 'SELECT task_key taskKey,outcome FROM admin_task_batch_items WHERE batch_id=? ORDER BY task_key', id);
 return { ok: true, results, applied: results.filter(r=>r.outcome==='applied').length, skipped: results.filter(r=>r.outcome==='skipped').length };
}
async function bulkUpdate(db: DB, m: Row, b: Row, tokenHash?: string) {
 const op = await operation(db,m,b,true,tokenHash); if (op.replayed) return { ...await bulkResult(db,op.id), replayed: true };
 const kind = str(b.operation,20), now = Date.now();
 if (!['review','assign','snooze','unsnooze'].includes(kind)) fail('Choose a supported bulk task action.');
 if (!Array.isArray(b.items) || !b.items.length || b.items.length>50) fail('Select between 1 and 50 tasks.');
 const assignee = kind==='assign' && b.assignee ? str(b.assignee,80) : null;
 if (assignee && !await first(db,"SELECT id FROM members WHERE id=? AND active=1 AND role='admin'",assignee)) fail('Choose an active administrator.');
 const until = kind==='snooze' ? int(b.snoozeUntil,now+60000,now+30*86400000) : null;
 const note = routineNote(b.note, ({review:'Adjustment notifications reviewed.',assign:'Task assignment updated.',snooze:'Follow-up reminders snoozed.',unsnooze:'Follow-up reminders restored.'} as Row)[kind]);
 const seen = new Set<string>(), statements: D1PreparedStatement[] = [stmt(db,'INSERT INTO admin_task_batches(id,actor,operation,created_at) VALUES(?,?,?,?)',op.id,m.id,kind,now)];
 if (assignee) statements.push(guard(db,"EXISTS(SELECT 1 FROM members WHERE id=? AND active=1 AND role='admin')",assignee));
 for (const item of b.items) {
  const key = str(item.taskKey,140), version = int(item.version,-1), expected = str(item.revision,64);
  if (seen.has(key)) fail('Each task can be selected once.'); seen.add(key);
  const task = await first(db,`SELECT * FROM (${tasksSQL}) WHERE task_key=?`,key);
  const matches = task && expected === await revision(task) && task.version===version;
  if (!matches) { statements.push(stmt(db,"INSERT INTO admin_task_batch_items(batch_id,task_key,outcome) VALUES(?,?,'skipped')",op.id,key)); continue; }
  const eligible = kind==='review' ? "dismissible=1 AND active=1 AND status<>'resolved'" : kind==='unsnooze' ? "status<>'resolved' AND snoozed_until IS NOT NULL" : "active=1 AND status<>'resolved'";
  // Test again inside the write transaction. Changed source records are skipped,
  // rather than aborting the other selections or silently acting on stale data.
  statements.push(stmt(db,`INSERT INTO admin_task_batch_items(batch_id,task_key,outcome) VALUES(?,?,CASE WHEN EXISTS(SELECT 1 FROM (${tasksSQL}) WHERE task_key=? AND version=? AND source_snapshot=? AND ${eligible}) THEN 'applied' ELSE 'skipped' END)`,op.id,key,key,version,task.source_snapshot));
 }
 const chosen = `SELECT t.* FROM (${tasksSQL}) t JOIN admin_task_batch_items b ON b.task_key=t.task_key WHERE b.batch_id=? AND b.outcome='applied'`;
 if (kind==='snooze') statements.push(stmt(db,`INSERT INTO admin_task_snoozes(task_key,until_at,source_snapshot,actor,updated_at) SELECT task_key,?,source_snapshot,?,? FROM (${chosen}) WHERE 1 ON CONFLICT(task_key) DO UPDATE SET until_at=excluded.until_at,source_snapshot=excluded.source_snapshot,actor=excluded.actor,updated_at=excluded.updated_at`,until,m.id,now,op.id));
 if (kind==='review'||kind==='unsnooze') statements.push(stmt(db,"DELETE FROM admin_task_snoozes WHERE task_key IN(SELECT task_key FROM admin_task_batch_items WHERE batch_id=? AND outcome='applied')",op.id));
 statements.push(stmt(db,`INSERT INTO admin_task_meta(task_key,assignee,state,due_at,updated_at) SELECT task_key,CASE WHEN ?='assign' THEN ? ELSE assignee END,CASE WHEN ?='review' THEN 'resolved' ELSE COALESCE(work_state,'open') END,deadline,? FROM (${chosen}) WHERE 1 ON CONFLICT(task_key) DO UPDATE SET assignee=excluded.assignee,state=excluded.state,version=admin_task_meta.version+1,updated_at=excluded.updated_at`,kind,assignee,kind,now,op.id));
 statements.push(stmt(db,`INSERT INTO admin_task_events(id,task_key,actor,kind,note,detail,created_at) SELECT ?||':'||task_key,task_key,?,'bulk_'||?,?,?,? FROM admin_task_batch_items WHERE batch_id=? AND outcome='applied'`,op.id,m.id,kind,note,JSON.stringify({batchId:op.id,operation:kind,assignee,snoozeUntil:until}),now,op.id));
 statements.push(audit(db,m.id,'admin_tasks_bulk_updated',op.id,{operation:kind,keys:[...seen],assignee,snoozeUntil:until,note}));
 await op.commit(statements); return bulkResult(db,op.id);
}
export async function updateTask(db: DB, m: Row, b: Row, tokenHash?: string) {
 if (b.action==='taskBulk') return bulkUpdate(db,m,b,tokenHash);
 const op = await operation(db,m,b,true,tokenHash); if (op.replayed) return {ok:true,replayed:true};
 const key = str(b.taskKey,140), task = await first(db,`SELECT * FROM (${tasksSQL}) WHERE task_key=?`,key);
 if (!task) fail('Task unavailable.',404);
 const now = Date.now();
 if (b.action==='tabReminder') {
  const note = noteText(b.note);
  if (task.type!=='tab'||!task.active) fail('This tab no longer needs a reminder.',409);
  await op.commit([guard(db,'EXISTS(SELECT 1 FROM members WHERE id=? AND debt>0)',task.target),stmt(db,"INSERT INTO admin_task_events(id,task_key,actor,kind,note,detail,created_at) VALUES(?,?,?,'reminder',?,?,?)",op.id,key,m.id,note,JSON.stringify({balance:task.amount,channel:'manual'}),now),audit(db,m.id,'tab_reminder_recorded',task.target,{note,balance:task.amount})]); return {ok:true};
 }
 const state = str(b.state,20), assignee = b.assignee ? str(b.assignee,80) : null, due = b.dueAt==null ? null : int(b.dueAt,0,8640000000000000), note = routineNote(b.note,'Task details updated.');
 if (!['open','in_progress','resolved'].includes(state)) fail('Choose a task status.');
 if (state==='resolved'&&!task.dismissible&&task.active) fail('Complete the linked action first. This task cannot clear its underlying record.');
 if (assignee&&!await first(db,"SELECT id FROM members WHERE id=? AND active=1 AND role='admin'",assignee)) fail('Choose an active administrator.');
 await op.commit([guard(db,'COALESCE((SELECT version FROM admin_task_meta WHERE task_key=?),-1)=?',key,int(b.version,-1)),
 guard(db,`EXISTS(SELECT 1 FROM (${tasksSQL}) WHERE task_key=? AND source_snapshot=?)`,key,task.source_snapshot),
 ...(assignee ? [guard(db,"EXISTS(SELECT 1 FROM members WHERE id=? AND active=1 AND role='admin')",assignee)] : []),
 stmt(db,'INSERT INTO admin_task_meta(task_key,assignee,state,due_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(task_key) DO UPDATE SET assignee=excluded.assignee,state=excluded.state,due_at=excluded.due_at,version=admin_task_meta.version+1,updated_at=excluded.updated_at',key,assignee,state,due,now),
 stmt(db,"INSERT INTO admin_task_events(id,task_key,actor,kind,note,detail,created_at) VALUES(?,?,?,'updated',?,?,?)",op.id,key,m.id,note,JSON.stringify({state,assignee,dueAt:due,reference:task.reference,amount:task.amount}),now),audit(db,m.id,'admin_task_updated',key,{state,assignee,note})]); return {ok:true};
}
