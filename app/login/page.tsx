'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
export default function Login(){
 const [mode,setMode]=useState('login'),[email,setEmail]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 function change(next:string){setMode(next);setError('');setMessage('')}
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError('');setMessage('');try{
  if(mode==='setup'&&f.get('password')!==f.get('confirm'))throw Error('The new passwords do not match.');
  const action=({login:'login',first:'firstTime',setup:'completeSetup',forgot:'requestReset'} as Record<string,string>)[mode];
  const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,email,password:f.get('password'),code:f.get('code')})});const result=await r.json() as {error?:string;message?:string};if(!r.ok)throw Error(result.error||'Please try again.');
  if(mode==='first'){setMode('setup');return}if(mode==='forgot'){setMessage(result.message||'Your request has been sent to the administrators.');return}
  const next=new URLSearchParams(window.location.search).get('next');window.location.replace(next&&/^\/products\/[a-zA-Z0-9_-]+$/.test(next)?next:'/');
 }catch(e){setError(e instanceof Error?e.message:'Try again.')}finally{setBusy(false)}}
 return <main className="login-shell"><section className="panel login-card"><div className="brand"><span className="brand-mark">I</span><span>IYAAYASFW<span className="brand-sub">Unit Supply</span></span></div><h1>{mode==='login'?'Member sign-in':mode==='forgot'?'Reset your password':mode==='setup'?'Create your password':'First time here?'}</h1><p>{mode==='login'?'Sign in with your approved email and password.':mode==='first'?'Start with the email your store administrator added to the member list.':mode==='setup'?'Use your private setup code to activate your account. Ask your administrator if you have not received one.':'Enter your account email. An administrator will receive a reset request inside the store.'}</p>
 <form onSubmit={submit}><fieldset disabled={busy}><label className="field"><span>Email address</span><Input name="email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} readOnly={mode==='setup'}/></label>
 {mode==='setup'?<label className="field"><span>Setup code</span><Input name="code" autoComplete="one-time-code" maxLength={80} required/></label>:null}
 {['login','setup'].includes(mode)?<label className="field"><span>{mode==='setup'?'New password':'Password'}</span><Input name="password" type="password" autoComplete={mode==='setup'?'new-password':'current-password'} required minLength={mode==='setup'?15:undefined} maxLength={128}/></label>:null}
 {mode==='setup'?<><label className="field"><span>Confirm new password</span><Input name="confirm" type="password" autoComplete="new-password" minLength={15} maxLength={128} required/></label><p className="fine">Use 15–128 characters. A phrase of several words works well.</p></>:null}
 {error?<p className="notice error" role="alert">{error}</p>:null}{message?<p className="notice" role="status">{message}</p>:null}<Button type="submit" className="full" disabled={busy}>{busy?'Please wait…':mode==='login'?'Sign in':mode==='first'?'Continue':mode==='setup'?'Create password & sign in':'Request a reset'}</Button></fieldset></form>
 {mode==='login'?<div className="login-actions"><Button type="button" variant="outline" onClick={()=>change('first')}>First Time</Button><Button type="button" variant="ghost" onClick={()=>change('forgot')}>Forgot password?</Button></div>:<Button type="button" variant="ghost" disabled={busy} onClick={()=>change('login')}>Back to sign-in</Button>}
 <p className="fine">Pickup only · Access by approved email.</p>{mode==='login'?<p className="fine">Sessions expire automatically. Administrators sign in more often to protect store controls. Use a personal device.</p>:null}</section></main>
}
