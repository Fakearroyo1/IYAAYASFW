import {type DB,type Row,fail,str,int,first,rows,stmt,audit,guard} from './core';
import {operation,noteText} from './operation';
const tasksSQL=`SELECT t.*,m.assignee,m.state work_state,COALESCE(m.version,-1) version,COALESCE(m.due_at,t.due_at) deadline,CASE WHEN t.active=0 OR(t.dismissible=1 AND m.state='resolved') THEN 'resolved' ELSE COALESCE(NULLIF(m.state,'resolved'),'open') END status FROM operational_tasks t LEFT JOIN admin_task_meta m ON m.task_key=t.task_key`;
export async function taskPage(db:DB,m:Row,q:Row){
 if(m.role!=='admin')fail('Verified administrator access is required.',403);
 const filter=q.filter||'open',search=str(q.search||'',100),offset=int(Number(q.offset||0),0,100000);
 if(!['open','resolved','mine','all'].includes(filter))fail('Choose a supported task view.');
 const where=[filter==='open'?"status<>'resolved'":filter==='resolved'?"status='resolved'":filter==='mine'?"assignee=? AND status<>'resolved'":'1=1'],args:any[]=filter==='mine'?[m.id]:[];
 if(search){where.push('(instr(lower(title),lower(?))>0 OR instr(lower(person),lower(?))>0 OR instr(lower(reference),lower(?))>0)');args.push(search,search,search)}
 if(q.type){where.push('type=?');args.push(str(q.type,20))}
 const records=await rows(db,`SELECT * FROM (${tasksSQL}) WHERE ${where.join(' AND ')} ORDER BY CASE severity WHEN 'high' THEN 0 ELSE 1 END,created_at DESC,task_key LIMIT 51 OFFSET ?`,...args,offset);
 const counts=await rows(db,`SELECT type,COUNT(*) count FROM (${tasksSQL}) WHERE status<>'resolved' GROUP BY type`);
 const now=Date.now(),today=Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth(),new Date(now).getUTCDate());
 const brief=await first(db,"SELECT (SELECT COALESCE(SUM(total),0) FROM order_balances WHERE status IN('paid','tab') AND created_at>=? AND created_at<?) yesterday_sales,(SELECT COALESCE(SUM(debt),0) FROM members) outstanding_tabs,(SELECT COUNT(*) FROM payments WHERE status='pending') pending_payments",today-86400000,today);
 const admins=await rows(db,"SELECT id,name FROM members WHERE active=1 AND role='admin' ORDER BY name,id");
 let task=null,events:Row[]=[];
 if(q.taskKey){task=await first(db,`SELECT * FROM (${tasksSQL}) WHERE task_key=?`,str(q.taskKey,140));if(task)events=await rows(db,'SELECT e.*,m.name actor_name FROM admin_task_events e JOIN members m ON m.id=e.actor WHERE task_key=? ORDER BY created_at DESC,id DESC LIMIT 100',task.task_key)}
 return {records:records.slice(0,50),nextOffset:records.length>50?offset+50:null,counts,brief,admins,task,events};
}
export async function updateTask(db:DB,m:Row,b:Row,tokenHash?:string){
 const op=await operation(db,m,b,true,tokenHash);if(op.replayed)return {ok:true,replayed:true};
 const key=str(b.taskKey,140),task=await first(db,`SELECT * FROM (${tasksSQL}) WHERE task_key=?`,key);
 if(!task)fail('Task unavailable.',404);
 const note=noteText(b.note),now=Date.now();
 if(b.action==='tabReminder'){
  if(task.type!=='tab'||!task.active)fail('This tab no longer needs a reminder.',409);
  await op.commit([guard(db,'EXISTS(SELECT 1 FROM members WHERE id=? AND debt>0)',task.target),stmt(db,"INSERT INTO admin_task_events(id,task_key,actor,kind,note,detail,created_at) VALUES(?,?,?,'reminder',?,?,?)",op.id,key,m.id,note,JSON.stringify({balance:task.amount,channel:'manual'}),now),audit(db,m.id,'tab_reminder_recorded',task.target,{note,balance:task.amount})]);return {ok:true};
 }
 const state=str(b.state,20),assignee=b.assignee?str(b.assignee,80):null,due=b.dueAt==null?null:int(b.dueAt,0,8640000000000000);
 if(!['open','in_progress','resolved'].includes(state))fail('Choose a task status.');
 if(state==='resolved'&&!task.dismissible&&task.active)fail('Complete the linked action first. This task cannot clear its underlying record.');
 if(assignee&&!await first(db,"SELECT id FROM members WHERE id=? AND active=1 AND role='admin'",assignee))fail('Choose an active administrator.');
 await op.commit([guard(db,'COALESCE((SELECT version FROM admin_task_meta WHERE task_key=?),-1)=?',key,int(b.version,-1)),
 ...(assignee?[guard(db,"EXISTS(SELECT 1 FROM members WHERE id=? AND active=1 AND role='admin')",assignee)]:[]),
 stmt(db,'INSERT INTO admin_task_meta(task_key,assignee,state,due_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(task_key) DO UPDATE SET assignee=excluded.assignee,state=excluded.state,due_at=excluded.due_at,version=admin_task_meta.version+1,updated_at=excluded.updated_at',key,assignee,state,due,now),
 stmt(db,"INSERT INTO admin_task_events(id,task_key,actor,kind,note,detail,created_at) VALUES(?,?,?,'updated',?,?,?)",op.id,key,m.id,note,JSON.stringify({state,assignee,dueAt:due,reference:task.reference,amount:task.amount}),now),audit(db,m.id,'admin_task_updated',key,{state,assignee,note})]);return {ok:true};
}
