"use client";
import { useEffect, useState } from "react";
import { Star, Shield, HandHeart, Compass, Medal, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field, type Row } from "./shared";
import { roadmapRead, useOperations, OperationsFeedback } from "./operations-action";
import { useRoadmap } from "./roadmap-shared";
import styles from "./member-flair.module.css";

const icons: Row = {star:Star,shield:Shield,hands:HandHeart,compass:Compass,medal:Medal,flag:Flag};
export function ProfileBadge({badge:b, compact=false}:{badge:Row;compact?:boolean}) {
  const Icon=icons[b.symbol] || Medal;
  return <span className={(compact?styles.badge:"recognition-badge")+" accent-"+b.color} title={b.description}>
    <Icon size={compact?15:22} aria-hidden="true"/><span>{b.name}{!compact?<small>{b.rarity}</small>:null}</span>
  </span>;
}
function Avatar({profile:p,compact=false}:{profile:Row;compact?:boolean}) {
  return p.avatar?<img className={compact?styles.avatar:"profile-avatar"} src={"/api/profile-images?id="+p.avatar} alt=""/>:
    <span className={compact?styles.initial:"profile-avatar placeholder"} aria-hidden="true">{(p.alias||p.memberName||"M").slice(0,1)}</span>;
}
export function MemberProfileCard({profile:p,onEdit}:{profile:Row;onEdit?:()=>void}) {
  return <section className={"public-profile accent-"+p.accent+" profile-theme-"+p.theme}>
    {p.banner?<img className="profile-banner" src={"/api/profile-images?id="+p.banner} alt="Member banner"/>:null}
    <div className="road-stack">
      <Avatar profile={p}/>
      <div><h2>{p.alias||p.memberName}</h2><p className="fine">Member name: {p.memberName}</p><p className="fine">{p.tier}</p></div>
      {p.bio?<p className={styles.bio}>{p.bio}</p>:null}
      {p.badges?.length?<div className="badge-shelf">{p.badges.map((b:Row)=><ProfileBadge key={b.award_id} badge={b}/>)}</div>:null}
      {onEdit?<Button type="button" variant="secondary" onClick={onEdit}>Customize my profile</Button>:null}
    </div>
  </section>;
}
export function MemberFlair({profile:p,fallbackName="Member"}:{profile?:Row|null;fallbackName?:string}) {
  const [open,setOpen]=useState(false),[view,setView]=useState<Row|null>(null),[error,setError]=useState("");
  const action=useOperations(async()=>{},"/api/roadmap");
  useEffect(()=>{
    if(!open||!p?.id)return;
    let current=true;
    setView(null);setError("");
    roadmapRead({kind:"profile",id:p.id}).then(r=>{if(current)setView(r.profile)}).catch(e=>{if(current)setError(e.message)});
    return ()=>{current=false};
  },[open,p?.id]);
  if(!p)return <span>{fallbackName}</span>;
  return <>
    <button type="button" className={styles.author+" accent-"+p.accent} onClick={()=>setOpen(true)} aria-label={"View "+p.alias+"'s profile"}>
      <Avatar profile={p} compact/>
      <span className={styles.identity}><strong>{p.alias||fallbackName}</strong><span className={styles.flair}>{p.tier}{p.badges?.map((b:Row)=><ProfileBadge key={b.award_id} badge={b} compact/>)}</span></span>
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="pilot-dialog">
        <DialogTitle>Member profile</DialogTitle>
        <DialogDescription>Recognition shared with signed-in members.</DialogDescription>
        {error?<p className="notice error" role="alert">{error}</p>:view?<>
          <MemberProfileCard profile={view}/>
          <details><summary>Report this profile</summary><form className="road-stack" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void action.send({action:"profileReport",id:view.id,reason:String(f.get("reason"))});}}>
            <Field label="What should the team review?"><textarea name="reason" required minLength={5} maxLength={500}/></Field>
            <Button type="submit" disabled={action.busy||!!action.pending}>Send report</Button><OperationsFeedback action={action}/>
          </form></details>
        </>:<p role="status">Loading profile…</p>}
      </DialogContent>
    </Dialog>
  </>;
}
export function AccountProfileCard({onCustomize}:{onCustomize?:()=>void}) {
  const state=useRoadmap({kind:"rewards"}),d=state.data;
  if(state.error)return <div className="panel"><p>Your profile could not be loaded.</p><Button type="button" variant="secondary" onClick={()=>void state.refresh().catch(()=>{})}>Reload profile</Button></div>;
  if(!d)return <p className="fine" role="status">Loading your recognition…</p>;
  if(!d.ownProfile)return null;
  return <div className={styles.account}>
    <MemberProfileCard profile={d.ownProfile} onEdit={onCustomize}/>
    <p className="fine">{Number(d.wallet?.available??d.total).toLocaleString()} Murley Bucks available · {Number(d.total).toLocaleString()} earned for recognition</p>
    {d.profile?.moderation==="pending"?<p className="fine">Your profile changes are awaiting review. Members continue to see your last approved profile.</p>:d.profile?.moderation==="hidden"?<p className="fine">Your profile is currently hidden by the store team.</p>:null}
    {!d.profile?.visible?<p className="fine">Your profile is private. You can change visibility in your profile settings.</p>:null}
  </div>;
}
