'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
export default function HistoryPager({cursor,dataset,admin=false,filter='',search='',onPage}:{cursor?:string|null;dataset:string;admin?:boolean;filter?:string;search?:string;onPage:(page:any)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function more(){setBusy(true);setError('');try{const q=new URLSearchParams({dataset,cursor:cursor!,scope:admin?'admin':'member',filter,search});const r=await fetch('/api/history?'+q,{cache:'no-store'});const j=await r.json() as Record<string,any>;if(!r.ok)throw Error(j.error);onPage(j)}catch(e){setError(e instanceof Error?e.message:'Records could not load.')}finally{setBusy(false)}}
 return cursor?<div className="history-pager"><Button variant="outline" disabled={busy} onClick={more}>{busy?'Loading…':'Load more records'}</Button>{error?<p className="notice error" role="alert">{error}</p>:null}</div>:null;
}
