'use client';
import {useEffect,useRef,useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {Button} from '@/components/ui/button';
import {downloadFile} from './member-import';
export type PrivateInvite={url:string;expiresAt:number;memberId?:string;memberName?:string};
export default function PrivateInvitation({invitation,onHide,run}: {invitation:PrivateInvite;onHide:()=>void;run:(task:()=>Promise<void>)=>Promise<void>}){
 const qr=useRef<HTMLDivElement>(null),[now,setNow]=useState(Date.now()),[copied,setCopied]=useState('');
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const expired=now>=invitation.expiresAt;
 const code=new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('invite')||'';
 const copy=(value:string,label:string)=>run(async()=>{await navigator.clipboard.writeText(value);setCopied(label+' copied.');});
 return <section className="identity-block" aria-label="Private member invitation"><h2>Private invitation — shown once</h2><p><strong>{invitation.memberName||'Verified member'}</strong></p><p>{expired?'This invitation has expired. Create a new one.':'Expires '+new Date(invitation.expiresAt).toLocaleString()+'. Valid for one completed enrollment.'}</p>{!expired&&<><p>Let this member scan the QR code, or copy the link into a private message to them. Anyone holding it can enroll a method for this member. Share it individually.</p><div className="identity-invitation-qr" ref={qr}><QRCodeSVG value={invitation.url} size={224} marginSize={4} level="M" title="Scan to accept this private member invitation"/></div><label className="field">Private invitation link<textarea readOnly value={invitation.url} rows={3} aria-label="Private invitation link"/></label><div className="identity-choices"><Button variant="outline" onClick={()=>copy(invitation.url,'Private link')}>Copy private link</Button><Button variant="outline" onClick={()=>{const svg=qr.current?.querySelector('svg');if(svg)downloadFile(new XMLSerializer().serializeToString(svg),'iyaayasfw-private-invitation.svg','image/svg+xml');}}>Download QR code</Button></div><details><summary>Invitation code</summary><p>The member can paste this code at {new URL(invitation.url).origin}/identity.</p><textarea readOnly value={code} rows={2} aria-label="Private invitation code"/><Button variant="outline" onClick={()=>copy(code,'Invitation code')}>Copy invitation code</Button></details></>}{copied&&<p role="status">{copied}</p>}<Button variant="ghost" onClick={onHide}>Hide invitation</Button></section>;
}
