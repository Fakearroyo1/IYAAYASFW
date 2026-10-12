// Real compiled UI/API and disposable D1. Access and Turnstile are synthetic providers.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {workflowWorker} from './workflow-worker.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.WORKFLOW_PLAYWRIGHT_MODULE||'playwright');
const f=await workflowWorker({challenge:true}),browser=await chromium.launch({headless:true,...(process.env.WORKFLOW_BROWSER_CHANNEL?{channel:process.env.WORKFLOW_BROWSER_CHANNEL}:{})});
const directory='.sites-runtime/workflow-audit-browser';mkdirSync(directory,{recursive:true});
let checks=0;const errors=[],check=(v,label)=>{assert.ok(v,label);checks++};
async function ctx(person,width=390){const c=await browser.newContext({viewport:{width,height:844}});await c.route('**/*',f.browserRoute);if(person)await c.addCookies([...person.cookies].map(([name,value])=>({name,value,domain:person.host,path:'/',secure:true,httpOnly:true,sameSite:'Lax'})));return c}
async function shot(page,label){await page.screenshot({path:directory+'/'+label+'.png',fullPage:true});}
async function fits(page,label){check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' fits viewport');const d=page.getByRole('dialog');if(await d.count())check(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1),label+' dialog fits');}
async function json(r,label){const response=await r,j=await response.json();check(response.status===200,label+': '+JSON.stringify(j));return j}
try{
  const original=await f.one("SELECT debt,credit FROM members WHERE id='member'");
  const anon=await ctx(null),login=await anon.newPage();login.on('pageerror',e=>errors.push(e.message));
  await login.goto('https://test.local/login?password=1');
  await login.getByRole('button',{name:'Forgot password?',exact:true}).click();
  await login.getByLabel('Email address',{exact:true}).fill('member@example.test');
  await login.getByRole('button',{name:'Request a reset',exact:true}).click();
  await login.getByText('your request is now in the administrators', {exact:false}).waitFor();
  check((await f.one("SELECT COUNT(*) n FROM password_reset_requests WHERE member_id='member' AND status='pending'")).n===1,'member reset request is durable');
  await login.getByRole('button',{name:'Request a reset',exact:true}).click();
  check((await f.one("SELECT COUNT(*) n FROM password_reset_requests WHERE member_id='member' AND status='pending'")).n===1,'repeat request creates no duplicate');
  const admin=await ctx(f.admin),page=await admin.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://admin.test.local/?view=admin&section=overview');
  await page.getByRole('button',{name:'Issue recovery code',exact:true}).click();
  let dialog=page.getByRole('dialog');
  check(await dialog.getByRole('button',{name:'Generate recovery code'}).isVisible(),'dashboard opens working recovery form directly');
  await dialog.getByRole('button',{name:'Generate recovery code'}).click();
  check(!(await f.one("SELECT member_id FROM auth_recovery WHERE member_id='member'")),'identity check is required before issuance');
  await dialog.getByLabel('I verified this member through a known contact method.').check();
  await dialog.getByRole('button',{name:'Generate recovery code'}).click();
  let code=await dialog.getByLabel('Private recovery code').inputValue();
  check(/^[a-f0-9]{32}$/.test(code),'private recovery code is generated');
  check((await f.one("SELECT code_hash FROM auth_recovery WHERE member_id='member'")).code_hash!==code,'only a hash is stored');
  const recoveryHref=await dialog.getByRole('link',{name:'the password recovery page'}).getAttribute('href');
  check(recoveryHref==='https://test.local/login?password=1&recovery=1','recovery instructions use the member host');
  await fits(page,'mobile recovery');await shot(page,'recovery-390');
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByText('Code issued · waiting for member',{exact:false}).waitFor();
  check((await f.one("SELECT status FROM password_reset_requests WHERE member_id='member'")).status==='pending','code issuance leaves request pending until use');
  await page.getByRole('button',{name:'Replace recovery code',exact:true}).click();
  await dialog.getByLabel('I verified this member through a known contact method.').check();
  await dialog.getByRole('button',{name:'Generate recovery code'}).click();
  const replacement=await dialog.getByLabel('Private recovery code').inputValue();check(replacement!==code,'replacement creates fresh authority');
  const anonymous={host:'test.local',cookies:new Map(),csrf:'',access:''};
  check((await f.request(anonymous,'/api/auth',{action:'completeRecovery',email:'member@example.test',code,password:'Replacement recovery phrase 123456',challengeToken:'test-valid'})).status===403,'superseded code cannot be used');
  code=replacement;await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await login.goto(recoveryHref);
  await login.getByLabel('Email address',{exact:true}).fill('member@example.test');
  await login.getByLabel('Recovery code',{exact:true}).fill(code);
  await login.getByLabel('New password',{exact:true}).fill('Replacement recovery phrase 123456');
  await login.getByLabel('Confirm new password',{exact:true}).fill('Replacement recovery phrase 123456');
  await login.getByRole('button',{name:'Save password & sign in',exact:true}).click();
  await login.getByRole('navigation',{name:'Store navigation'}).waitFor();
  check((await f.one("SELECT status FROM password_reset_requests WHERE member_id='member'")).status==='resolved','member completion resolves request');
  check(!(await f.one("SELECT member_id FROM auth_recovery WHERE member_id='member'")),'used code is removed');
  check((await f.request(f.member,'/api/pilot')).status===401,'old member sessions are revoked');
  check((await f.request(anonymous,'/api/auth',{action:'completeRecovery',email:'member@example.test',code,password:'Replacement recovery phrase 123456',challengeToken:'test-valid'})).status===403,'used code cannot be replayed');
  check(JSON.stringify(await f.one("SELECT debt,credit FROM members WHERE id='member'"))===JSON.stringify(original),'recovery preserves member money');
  await page.getByRole('button',{name:'Refresh dashboard'}).click();
  await page.getByRole('button',{name:'Replace recovery code',exact:true}).waitFor({state:'hidden'});
  check(true,'resolved reset disappears from dashboard');

  // A member completes snack checkout and reports payment; the admin confirms from one card.
  await login.getByRole('button',{name:'Add Synthetic drink',exact:true}).click();
  await login.getByRole('button',{name:/Review bag/}).click();
  await login.getByRole('dialog').getByRole('button',{name:'Add $2.50 to tab',exact:true}).click();
  await login.getByRole('dialog').getByRole('heading',{name:'Added to tab',exact:true}).waitFor();
  await login.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  check((await f.one("SELECT stock FROM products WHERE id='drink'")).stock===19,'browser snack checkout deducts stock once');
  const freshCookies=await anon.cookies('https://test.local'),memberSession={host:'test.local',cookies:new Map(freshCookies.map(c=>[c.name,c.value])),csrf:'',access:''};await f.context(memberSession);
  const payId=crypto.randomUUID();await json(f.request(memberSession,'/api/pilot',{action:'payment',id:payId,purpose:'settlement',method:'cash',amount:975}),'member reports tab payment');
  await page.getByRole('button',{name:'Refresh dashboard'}).click();
  await page.getByRole('button',{name:'Confirm payment',exact:true}).click();
  dialog=page.getByRole('dialog');await dialog.getByLabel('Amount actually received ($)').waitFor();
  await dialog.getByLabel('I checked the cash or Cash App transaction',{exact:false}).check();
  await dialog.getByRole('button',{name:'Confirm payment',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  check((await f.one('SELECT status FROM payments WHERE id=?',payId)).status==='verified','dashboard confirms actual payment');
  check((await f.one("SELECT debt FROM members WHERE id='member'")).debt===0,'confirmation settles the current tab');
  check((await f.one("SELECT COUNT(*) n FROM money_movements WHERE source_type='payment' AND source_id=?",payId)).n===1,'confirmation produces one financial movement');
  await page.getByRole('button',{name:'Confirm payment',exact:true}).waitFor({state:'hidden'});check(true,'confirmed payment leaves quick list without navigation');

  // A long roster stays mounted; selection and nested edits never move the document.
  for(let n=0;n<65;n++)await f.run('INSERT INTO members(id,name,email,role) VALUES(?,?,?,\'member\')','roster-'+n,'Roster member '+String(n).padStart(2,'0'),'roster'+n+'@example.test');
  await page.getByRole('navigation',{name:'Store management'}).getByRole('button',{name:'Members',exact:true}).click();
  await page.getByLabel('Find a member',{exact:true}).fill('Roster');
  await page.waitForFunction(()=>document.querySelector('.identity-members')?.textContent.includes('Roster member 49'));
  await page.locator('.identity-members').evaluate(el=>{el.scrollTop=el.scrollHeight});
  const opener=page.locator('.identity-members').getByRole('button',{name:/Roster member 49/});
  await opener.scrollIntoViewIfNeeded();
  const before=await page.evaluate(()=>({page:scrollY,list:document.querySelector('.identity-members').scrollTop}));
  await opener.click();
  dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Roster member 49',exact:true}).waitFor();
  check(await dialog.getByRole('button',{name:'Edit account & purchasing permissions'}).isVisible(),'selected member management is visible immediately');
  await dialog.getByRole('button',{name:'Edit account & purchasing permissions'}).click();
  await page.getByRole('dialog').getByRole('heading',{name:'Edit member',exact:true}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('dialog').getByRole('heading',{name:'Roster member 49',exact:true}).waitFor();
  check(true,'closing account editor returns to the selected member');
  for(const width of [320,390,430,1280]){await page.setViewportSize({width,height:844});await fits(page,'member '+width);await shot(page,'member-'+width);}
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('dialog').getByRole('button',{name:'Back to members',exact:false}).click();
  const after=await page.evaluate(()=>({page:scrollY,list:document.querySelector('.identity-members').scrollTop}));
  check(await page.getByLabel('Find a member',{exact:true}).inputValue()==='Roster','member search is preserved');
  check(Math.abs(before.list-after.list)<2,'roster scroll is preserved');
  // Width changes can legitimately reflow the page; verify same-width open/close separately.
  const stable=await page.evaluate(()=>scrollY);await opener.click();await page.getByRole('dialog').getByRole('heading',{name:'Roster member 49',exact:true}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Back to members',exact:false}).click();
  check(Math.abs(await page.evaluate(()=>scrollY)-stable)<2,'opening and closing a member preserves page scroll');
  check(await opener.evaluate(el=>document.activeElement===el),'focus returns to the selected roster member');
  await page.getByLabel('Find a member',{exact:true}).fill('Synthetic member');
  await page.locator('.identity-members').getByRole('button',{name:/Synthetic member/}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Issue password recovery code',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Generate recovery code'}).waitFor();check(true,'member account includes working recovery without searching another screen');
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Back to members',exact:false}).click();
  check(errors.length===0,'no browser errors: '+JSON.stringify(errors));check(f.outbound()===0,'no live provider traffic');
  const report={suite:'workflow-audit-browser',checks,engine:await browser.version(),runtime:'compiled Worker and isolated D1; synthetic Access/Turnstile',screenshots:directory,passedAt:new Date().toISOString()};writeFileSync(directory+'/evidence.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){for(const c of browser.contexts())for(const p of c.pages())try{await shot(p,'failure-'+p.url().includes('admin'));writeFileSync(directory+'/failure.html',await p.content())}catch{}throw e}
finally{await browser.close();await f.close()}
