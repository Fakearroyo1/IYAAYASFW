"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { operationsRead } from "./operations-action";
import { type Row, money } from "./shared";
import { adminGroups } from "./admin-navigation";

const queues = [
  {label:"Payments to confirm",types:["payment"],destination:"payments",hint:"Match cash and Cash App receipts"},
  {label:"Member support",types:["reset","email"],destination:"attention",hint:"Password resets and email changes"},
  {label:"Restock & stock checks",types:["stock"],destination:"attention",hint:"Items and options needing stock"},
  {label:"Orders to fulfill",types:["pickup","guest"],destination:"attention",hint:"Member and guest orders"},
  {label:"Community & profiles",types:["report","profile","profile-report","request"],destination:"attention",hint:"Requests, reports, and profile reviews"},
  {label:"Team follow-up",types:["team","trial","adjustment"],destination:"attention",hint:"Questions, trial reviews, and adjustments"},
];

export default function AdminDashboard({onNavigate,onInbox}:{onNavigate:(tab:string)=>void;onInbox:(type:string)=>void}) {
  const [data,setData]=useState<Row|null>(null),[error,setError]=useState("");
  async function load(){const d=await operationsRead({kind:"inbox",filter:"open"});setData(d);setError("")}
  useEffect(()=>{let live=true;operationsRead({kind:"inbox",filter:"open"}).then(d=>{if(live)setData(d)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[]);
  const count=(types:string[])=>data?.counts.reduce((n:number,row:Row)=>n+(types.includes(row.type)?Number(row.count):0),0)??0;
  return <section className="panel management-dashboard">
    <div className="section-title"><div><span className="eyebrow">Your next steps</span><h2>Store dashboard</h2><p className="fine">Open the work that needs you. All records stay in their original workflow.</p></div><Button variant="ghost" aria-label="Refresh dashboard" onClick={()=>load().catch(e=>setError(e.message))}><RefreshCw size={17}/></Button></div>
    {error?<p className="notice error" role="alert">{error}</p>:null}
    <div className="dashboard-queues">{queues.map(q=><button type="button" key={q.label} onClick={()=>q.destination==="attention"?onInbox(q.types.join(",")):onNavigate(q.destination)}><span><strong>{q.label}</strong><small>{q.hint}</small></span><b>{data?count(q.types):"…"}</b><ArrowUpRight size={17}/></button>)}</div>
    <div className="dashboard-brief"><p><span>Yesterday’s sales · UTC</span><strong>{data?money(data.brief.yesterday_sales):"…"}</strong></p><p><span>Outstanding tabs</span><strong>{data?money(data.brief.outstanding_tabs):"…"}</strong></p><button type="button" onClick={()=>onInbox("tab")}>Review tab reminders <ArrowUpRight size={16}/></button></div>
    <details className="dashboard-directory"><summary>Find a management tool</summary><div>{adminGroups.slice(1).map(group=><section key={group.title}><h3>{group.title}</h3>{group.items.map(([id,label])=><button type="button" key={id} onClick={()=>onNavigate(id)}>{label}<ArrowUpRight size={14}/></button>)}</section>)}</div></details>
  </section>;
}
