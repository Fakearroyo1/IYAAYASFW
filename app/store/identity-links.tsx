"use client";
import {useEffect,useState} from 'react';
export function IdentityLinks(){
 const [links,setLinks]=useState<{member:string;admin:string}|null>(null);
 useEffect(()=>{void fetch('/identity/api').then(r=>r.json()).then((c:any)=>{if(c.enabled)setLinks(c.origins);}).catch(()=>{});},[]);
 return links?<div className="identity-links"><a href={links.member+'/identity'}>Sign-in methods &amp; sessions</a><a href={links.admin+'/identity'}>Access management</a></div>:null;
}
