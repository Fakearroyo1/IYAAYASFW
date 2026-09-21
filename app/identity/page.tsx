"use client";
import {useEffect,useState} from 'react';
import {startAuthentication,startRegistration} from '@simplewebauthn/browser';
import {BrandMark,ThemeToggle} from '@/app/store/appearance';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
type Method='google'|'microsoft'|'passkey';
type Row=Record<string,any>;
const names:Record<Method,string>={google:'Google',microsoft:'Personal Microsoft',passkey:'Passkey'};
export default function IdentityPage(){
 const [context,setContext]=useState<Row|null>(null),[flow,setFlow]=useState<Row|null>(null),[account,setAccount]=useState<Row|null>(null),[admin,setAdmin]=useState<Row|null>(null),[detail,setDetail]=useState<Row|null>(null),[preview,setPreview]=useState<Row|null>(null),[approval,setApproval]=useState<Row|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[invite,setInvite]=useState(''),[bridge,setBridge]=useState(''),[query,setQuery]=useState(''),[csv,setCsv]=useState(''),[selectedRows,setSelectedRows]=useState<number[]>([]),[privateInvite,setPrivateInvite]=useState<Row|null>(null);
 async function api(body:Row){
  // Refresh the session-bound CSRF value after every authentication transition.
  const c=await fetch('/identity/api',{cache:'no-store'}),ctx=await c.json() as Row;
  if(!c.ok||!ctx.enabled)throw Error(ctx.error||'New sign-in methods are not enabled yet.');
  const r=await fetch('/identity/api',{method:'POST',headers:{'Content-Type':'application/json','x-identity-csrf':ctx.csrf},body:JSON.stringify(body)}),data=await r.json() as Row;
  if(!r.ok)throw Error(data.error||'This request could not be completed.');return data;
 }
 async function run(task:()=>Promise<void>){setBusy(true);setError('');setMessage('');try{await task();}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
 const follow=(r:Row)=>{if(r.next)window.location.assign(r.next);};
 async function refreshAccount(){setAccount(await api({action:'account'}));}
 async function reloadFlow(){if(flow)setFlow((await api({action:'flow',flow:flow.id})).flow);}
 useEffect(()=>{let cancelled=false;void run(async()=>{
  const r=await fetch('/identity/api',{cache:'no-store'}),ctx=await r.json() as Row;if(cancelled)return;setContext(ctx);if(!r.ok)throw Error(ctx.error);if(!ctx.enabled)return;
  const url=new URL(window.location.href),fragment=new URLSearchParams(url.hash.slice(1));
  const invitation=fragment.get('invite'),code=fragment.get('code'),completedFlow=fragment.get('flow');
  if(url.hash)window.history.replaceState(null,'',url.pathname+url.search);
  if(invitation)setInvite(invitation);
  if(code&&completedFlow){follow(await api({action:'complete',code,flow:completedFlow}));return;}
  const bridgeId=url.searchParams.get('bridge');if(bridgeId)setBridge(bridgeId);
  if(ctx.host==='member'&&!ctx.user&&!bridgeId&&!invitation){window.location.replace('/login?next=/identity');return;}
  const flowId=url.searchParams.get('flow');if(flowId){
   const adopted=(await api({action:'adopt',flow:flowId})).flow;setFlow(adopted);
   const selected=url.searchParams.get('method');
   if(ctx.host==='auth'&&adopted.purpose!=='fresh'&&(selected==='google'||selected==='microsoft')&&ctx.methods[selected]){follow(await api({action:'provider',flow:flowId,method:selected}));return;}
  }
  const approvalId=url.searchParams.get('approval');if(approvalId)setApproval({id:approvalId,...await api({action:'approval',approval:approvalId})});
  if(url.searchParams.get('error'))setError(url.searchParams.get('error')!.slice(0,200));
  if(ctx.user){setAccount(await api({action:'account'}));if(ctx.owner)setAdmin(await api({action:'adminRead',query:''}));}
 });return()=>{cancelled=true;};},[]);
 async function start(purpose?:string,payload?:Row,selected?:Method){
  const result=await api({action:'start',purpose,payload,next:'/identity'});if(selected&&result.next.includes('?flow='))result.next+='&method='+selected;follow(result);
 }
 async function choose(method:Method){
  if(!flow){await start(undefined,undefined,method);return;}
  if(context?.host==='register'&&method!=='passkey'){follow(await api({action:'enrollProvider',flow:flow.id,method}));return;}
  if(method!=='passkey'){follow(await api({action:'provider',flow:flow.id,method}));return;}
  const registration=context?.host==='register',r=await api({action:'passkeyOptions',flow:flow.id});
  try{
   const response=registration?await startRegistration({optionsJSON:r.options}):await startAuthentication({optionsJSON:r.options});
   const result=await api({action:'passkeyVerify',flow:flow.id,ceremony:r.ceremony,response});if(result.reload)await reloadFlow();else follow(result);
  }catch(e){if(e instanceof Error&&e.name==='NotAllowedError')throw Error('Passkey sign-in was cancelled or no passkey was available. Try again or choose another method.');throw e;}
 }
 const choices=(enroll=false)=><div className="identity-choices">{(Object.keys(names) as Method[]).filter(method=>flow?.purpose!=='fresh'||flow.freshMethods?.includes(method)).map(method=><Button key={method} type="button" variant="outline" disabled={busy||!context?.methods?.[method]} onClick={()=>run(()=>choose(method))}>{enroll?'Add ':''}{names[method]}{!context?.methods?.[method]?' · unavailable':''}</Button>)}</div>;
 async function confirmApproval(){
  if(!approval)return;
  let r;if(approval.payload)r=await api({action:'admin',approval:approval.id,payload:approval.payload});
  else if(approval.purpose.startsWith('unlink:'))r=await api({action:'own',operation:'unlink',target:approval.purpose.slice(7),approval:approval.id});
  else throw Error('This approval cannot be used here.');
  setApproval(null);window.history.replaceState(null,'','/identity');
  if(r.url)setPrivateInvite(r);else setMessage(r.message||(r.results?`${r.applied} rows applied; ${r.alreadyApplied} already applied; ${r.conflicts} need review.`:'Saved.'));
  await refreshAccount();if(context?.owner)setAdmin(await api({action:'adminRead',query}));
 }
 const requestOwner=(payload:Row)=>start('owner',payload);
 return <main className="identity-shell"><section className="panel identity-panel">
  <header className="identity-heading"><a href={context?.origins?.member||'/'} className="brand"><BrandMark/><span>IYAAYASFW<span className="brand-sub">Member access</span></span></a><ThemeToggle/></header>
  <h1>{context?.host==='admin'?'Access management':context?.host==='register'?'Add a sign-in method':context?.user?'Your sign-in methods':'Sign in to Unit Supply'}</h1>
  {!context?<p>Loading…</p>:!context.enabled?<><p>This update is not enabled yet. Your existing password still works.</p><a href="/login?password=1">Use existing password</a></>:<>
   {context.user&&<p>Signed in as <strong>{context.user.name}</strong>. Your account and purchase history stay the same when you add a method.</p>}
   {context.host==='admin'&&!context.user&&<><p>Complete sign-in with your approved administrator account.</p><Button disabled={busy} onClick={()=>run(async()=>follow(await api({action:'adminLogin'})))}>Enter management</Button></>}
   {bridge&&<><p>Continue this private invitation in this browser. If you are signed in as a different member, sign out first.</p><Button disabled={busy} onClick={()=>run(async()=>follow(await api({action:'bridge',flow:bridge})))}>Continue invitation</Button></>}
   {invite&&context.host==='register'&&<><p>This private invitation adds one sign-in method to an existing approved member. It does not create a new membership.</p><Button disabled={busy} onClick={()=>run(async()=>{const result=await api({action:'invite',token:invite});setInvite('');follow(result);})}>Continue with invitation</Button></>}
   {flow&&<section className="identity-block">
    {flow.review?<><h2>Jake needs to review this sign-in</h2><p>No member access was granted. Contact Jake using a known contact method. After approval, start a new sign-in.</p></>:flow.purpose==='fresh'&&context.host==='register'?<><h2>Verify an existing method first</h2><p>A signed-in session alone cannot add a sign-in method.</p><Button disabled={busy} onClick={()=>run(async()=>follow(await api({action:'continueFresh',flow:flow.id})))}>Continue to verification</Button></>:flow.proof&&context.host==='register'?<>
     <h2>Confirm this addition</h2><p>Member: <strong>{flow.target}</strong></p><p>New method: {names[flow.proof.kind as Method]} {flow.proof.email&&<span>({flow.proof.email})</span>}</p>
     <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>follow(await api({action:'finishEnrollment',flow:flow.id,proofId:flow.proofId,label:f.get('label')||''})));}}>{flow.proof.kind==='passkey'&&<label className="field">Passkey name<Input name="label" maxLength={80} placeholder="My phone"/></label>}<Button disabled={busy}>Confirm &amp; continue</Button></form>
    </>:<>
     <h2>{flow.purpose==='fresh'?'Verify an existing method':flow.purpose==='enroll'?'Choose your new method':'Choose a sign-in method'}</h2>
     {flow.target&&<p>Invitation for <strong>{flow.target}</strong>. Stop and contact Jake if this is not you.</p>}
     {flow.purpose==='fresh'&&<p>{flow.hasPassword&&!flow.freshMethods?.length?'Enter your existing account password below. After verification, you can add your new method.':'Use a method already linked to your account.'} This approval lasts five minutes and applies only to the requested change.</p>}
     {choices(flow.purpose==='enroll')}
     {flow.hasPassword&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>follow(await api({action:'passwordProof',flow:flow.id,password:f.get('password')})));}}><label className="field">Existing password<Input type="password" name="password" autoComplete="current-password" maxLength={128} required/></label><Button disabled={busy} variant="outline">Verify existing password</Button></form>}
    </>}
   </section>}
   {!flow&&!invite&&!bridge&&!context.user&&context.host==='member'&&<p>Opening sign-in…</p>}
   {flow?.purpose==='login'&&context.host==='auth'&&<p><a href={context.origins.member+'/login?password=1&next='+encodeURIComponent(flow.returnPath||'/')}>Use existing password</a></p>}
   {!flow&&!invite&&context.host==='register'&&<p>A private invitation or fresh verification of an existing method is required. Ask Jake for help if you cannot sign in.</p>}
   {!flow&&context.host==='auth'&&<p><a href={context.origins.member+'/login'}>Start a new sign-in</a></p>}
   {approval&&<section className="identity-block"><h2>Confirm the verified change</h2>{approval.payload?<dl>{Object.entries(approval.payload).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{Array.isArray(v)?v.join(', '):String(v)}</dd></div>)}</dl>:<p>Remove the selected sign-in method. Another usable method must remain.</p>}<Button disabled={busy} onClick={()=>run(confirmApproval)}>Confirm change</Button></section>}
   {account&&context.host==='member'&&<>
    <section className="identity-block"><h2>Linked methods</h2>{account.hasPassword&&<p>Existing password · available</p>}{account.methods.map((m:Row)=><div className="identity-row" key={m.id}><span><strong>{m.label}</strong><small>{names[m.kind as Method]} · {m.status}{m.observed_email?' · '+m.observed_email:''}</small></span>{m.status==='active'&&<div>{m.kind==='passkey'&&<Button variant="ghost" disabled={busy} onClick={()=>{const label=window.prompt('Passkey name',m.label);if(label)void run(async()=>{await api({action:'own',operation:'rename',target:m.id,label});await refreshAccount();});}}>Rename</Button>}<Button variant="ghost" disabled={busy} onClick={()=>run(()=>start('unlink:'+m.id))}>Remove</Button></div>}</div>)}<p>Adding a backup method is recommended. You can keep using your existing password.</p><div className="identity-choices">{(Object.keys(names) as Method[]).map(m=><Button key={m} variant="outline" disabled={busy||!context.methods[m]} onClick={()=>run(()=>start('add:'+m))}>Add {names[m]}</Button>)}</div></section>
    <section className="identity-block"><h2>Signed-in sessions</h2>{account.sessions.map((s:Row)=><div className="identity-row" key={s.id}><span>{s.current?'This session':s.kind?names[s.kind as Method]:'Existing password'}<small>Started {new Date(s.created_at).toLocaleString()}</small></span><Button variant="ghost" disabled={busy} onClick={()=>run(async()=>{await api({action:'own',operation:'revokeSession',target:s.id});if(s.current)window.location.assign('/login');else await refreshAccount();})}>Sign out</Button></div>)}<Button variant="outline" disabled={busy} onClick={()=>run(async()=>{await api({action:'own',operation:'logoutAll'});window.location.assign('/login');})}>Sign out everywhere</Button></section>
   </>}
   {context.owner&&admin&&<section className="identity-block"><h2>Identity workspace</h2><p>Only Jake can create new login authority. Existing commerce permissions are managed in the store.</p>
    <form onSubmit={e=>{e.preventDefault();void run(async()=>setAdmin(await api({action:'adminRead',query})));}}><label className="field">Find a member<Input value={query} onChange={e=>setQuery(e.target.value)} maxLength={100}/></label><Button disabled={busy} variant="outline">Search</Button></form>
    <div className="identity-members">{admin.members.map((m:Row)=><button key={m.id} type="button" disabled={busy} onClick={()=>run(async()=>setDetail(await api({action:'adminRead',target:m.id})))}><strong>{m.name}</strong><small>{m.email} · {m.active?'Active':'Disabled'} · {m.id}</small></button>)}</div>
    {detail&&<section className="identity-block"><h3>{detail.member.name}</h3><p>Member ID: {detail.member.id}<br/>Roster address: {detail.member.email}<br/>Contact address: {detail.member.contact_email||'No separate contact'}</p>
     {detail.member.active?<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(()=>requestOwner({operation:'invite',target:detail.member.id,purpose:f.get('purpose'),seconds:Number(f.get('seconds')),identityVerified:f.get('verified')==='on'}));}}><label className="field">Invitation purpose<select name="purpose"><option value="enroll">Add a method</option><option value="recovery">Recover access after verification</option></select></label><label className="field">Expires in<select name="seconds"><option value="86400">One day</option><option value="900">15 minutes, in person</option><option value="604800">Seven days</option></select></label><label><input type="checkbox" name="verified" required/> I verified this member through a known contact method.</label><Button disabled={busy}>Verify &amp; create private invitation</Button></form>:<p>This account is disabled. Existing member controls can reactivate access; old credentials and grants stay revoked as recorded.</p>}
     <h3>Methods and invitations</h3>{detail.methods.map((m:Row)=><div className="identity-row" key={m.id}><span>{m.label}<small>{m.kind} · {m.status}</small></span>{m.status==='active'&&<Button variant="ghost" disabled={busy} onClick={()=>{const reason=window.prompt('Reason for revoking this method');if(reason)void run(()=>requestOwner({operation:'revokeMethod',target:detail.member.id,credentialId:m.id,reason}));}}>Revoke</Button>}</div>)}
     {detail.grants.map((g:Row)=><div className="identity-row" key={g.id}><span>{g.kind} · {g.provider||g.purpose}<small>{g.status} · expires {new Date(g.expires_at).toLocaleString()}</small></span>{g.status==='pending'&&<Button variant="ghost" disabled={busy} onClick={()=>run(()=>requestOwner({operation:'revokeGrant',target:g.id}))}>Revoke</Button>}</div>)}
     <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(()=>requestOwner({operation:'bootstrap',target:detail.member.id,provider:f.get('provider'),email:f.get('email')}));}}><h3>Authorize one first-login address</h3><p>This creates new provider-specific authority. Microsoft automatic matching remains disabled; invitations are available.</p><label className="field">Provider<select name="provider"><option value="google">Google</option><option value="microsoft">Personal Microsoft (automatic matching disabled)</option></select></label><label className="field">Exact address<Input name="email" type="email" required maxLength={254}/></label><Button disabled={busy} variant="outline">Verify &amp; create grant</Button></form>
     <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(()=>requestOwner({operation:'contact',target:detail.member.id,email:f.get('email')}));}}><label className="field">Separate contact address<Input name="email" type="email" required maxLength={254}/></label><Button disabled={busy} variant="outline">Verify &amp; update contact</Button></form>
     <div className="identity-choices">{['revokeSessions','contain'].map(operation=><Button key={operation} variant="outline" disabled={busy} onClick={()=>{const reason=window.prompt(operation==='contain'?'Reason for disabling this account and revoking pending access':'Reason for signing out all sessions');if(reason)void run(()=>requestOwner({operation,target:detail.member.id,reason}));}}>{operation==='contain'?'Contain account':'Revoke all sessions'}</Button>)}</div>
     <details><summary>Recent security events</summary>{detail.events.map((e:Row,i:number)=><p key={i}>{new Date(e.created_at).toLocaleString()} · {e.event}</p>)}</details>
    </section>}
    <h3>Provider requests needing review</h3>{!admin.requests.length&&<p>No pending requests.</p>}{admin.requests.map((r:Row)=><div className="identity-block" key={r.id}><p>{names[r.provider as Method]} · {r.observed_email||'No email supplied'}<br/>Reference: {r.id}</p><p>A matching name or email is a suggestion only. Verify the person independently.</p><div className="identity-choices"><Button disabled={busy||!detail?.member.active} onClick={()=>{const reason=window.prompt('How did you independently verify this person?');if(reason)void run(()=>requestOwner({operation:'reviewLink',target:detail!.member.id,requestId:r.id,identityVerified:true,reason}));}}>Link to selected member</Button>{['reviewReject','reviewBlock'].map(operation=><Button key={operation} disabled={busy} variant="outline" onClick={()=>{const reason=window.prompt('Reason');if(reason)void run(()=>requestOwner({operation,target:r.id,reason}));}}>{operation==='reviewReject'?'Reject':'Block'}</Button>)}</div></div>)}
    <h3>Roster preview</h3><p>Use explicit existing member IDs. Blank cells preserve values. Names and emails never select a different member automatically.</p><code className="identity-template">member_id,display_name,contact_email,google_bootstrap_email,microsoft_bootstrap_email,access_enabled</code><label className="field">CSV rows<textarea rows={6} value={csv} onChange={e=>setCsv(e.target.value)} maxLength={65536}/></label><Button disabled={busy||!csv} variant="outline" onClick={()=>run(async()=>{const p=await api({action:'importPreview',csv});setPreview(p);setSelectedRows(p.rows.filter((r:Row)=>r.status==='Update').map((r:Row)=>r.number));})}>Preview changes</Button>
    {preview&&<><div className="identity-table"><table><thead><tr><th>Apply</th><th>Member</th><th>Result</th><th>Exact changes</th></tr></thead><tbody>{preview.rows.map((r:Row)=><tr key={r.number}><td><input aria-label={'Apply row '+r.number} type="checkbox" disabled={r.errors.length>0} checked={selectedRows.includes(r.number)} onChange={e=>setSelectedRows(v=>e.target.checked?[...v,r.number]:v.filter(n=>n!==r.number))}/></td><td>{r.name}<small>{r.memberId}</small></td><td>{r.status}</td><td>{r.errors.join('; ')||r.changes.join('; ')||'No new authority'}{r.grants.map((g:Row)=><small key={g.provider}>{g.provider}: {g.raw} → {g.match}{g.create?' (new grant)':' (existing reservation preserved)'}</small>)}</td></tr>)}</tbody></table></div><Button disabled={busy||!selectedRows.length} onClick={()=>run(()=>requestOwner({operation:'importCommit',batch:preview.batch,hash:preview.hash,rows:selectedRows}))}>Verify &amp; apply selected rows</Button></>}
   </section>}
   {privateInvite&&<section className="identity-block"><h2>Private invitation — shown once</h2><p>Share individually with the verified member. Do not post it in a group or include it in an issue report.</p><textarea readOnly value={privateInvite.url} rows={3} aria-label="Private invitation link"/><Button variant="outline" onClick={()=>run(async()=>{await navigator.clipboard.writeText(privateInvite.url);setMessage('Private link copied.');})}>Copy private link</Button><Button variant="ghost" onClick={()=>setPrivateInvite(null)}>Hide link</Button></section>}
   <nav className="identity-links"><a href={context.origins.member}>Store</a><a href={context.origins.member+'/login?password=1'}>Existing password</a>{context.host==='admin'?<a href="/?view=admin">Commerce management</a>:<a href={context.origins.admin+'/identity'}>Management</a>}</nav>
  </>}
  {error&&<p className="notice error" role="alert">{error}</p>}{message&&<p className="notice" role="status">{message}</p>}{busy&&<p role="status">Please wait…</p>}
  <p className="fine">Need help? Contact Jake through a known contact method. Never share passwords, private invitation links, recovery codes, or sign-in screenshots containing them.</p>
 </section></main>;
}
