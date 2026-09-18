'use client';
import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import type {Row} from './shared';
export function useOperations(onSuccess:()=>Promise<unknown>){
 const locked=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<Row|null>(null);
 async function send(body:Row,retry=false):Promise<Row|null>{
  if(locked.current||(pending&&!retry))return null;
  locked.current=true;setBusy(true);setError('');setNotice('');
  const request=retry?body:{...body,requestId:crypto.randomUUID()};setPending(request);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{
   const r=await fetch('/api/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal}),j=await r.json() as Row;
   if(!r.ok){if(r.status<500)setPending(null);throw Error(j.error||'The action could not be confirmed.')}
   setPending(null);setNotice('Saved.');
   try{await onSuccess()}catch{setNotice('Saved. Refresh to see the latest version.')}
   return j;
  }catch(e){setError(e instanceof Error&&e.name!=='AbortError'?e.message:'Confirmation did not arrive. Retry this action.');return null}
  finally{clearTimeout(timeout);locked.current=false;setBusy(false)}
 }
 return {busy,error,notice,pending,send,retry:()=>pending?send(pending,true):Promise.resolve(null)};
}
export function OperationsFeedback({action}:{action:ReturnType<typeof useOperations>}){return <>{action.error?<p className="notice error" role="alert">{action.error}</p>:null}{action.notice?<p className="notice success" role="status">{action.notice}</p>:null}{action.pending?<div className="notice warning">Confirmation pending. <Button type="button" disabled={action.busy} onClick={action.retry}>Retry this action</Button></div>:null}</>}
export async function operationsRead(q:Record<string,string>){const r=await fetch('/api/operations?'+new URLSearchParams(q),{cache:'no-store'}),j=await r.json() as Row;if(!r.ok)throw Error(j.error||'Could not load this view.');return j as Row}
