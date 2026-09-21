"use client";
import {useEffect,useState} from 'react';
export function IdentityLinks({compact=false}:{compact?:boolean}){
 const [links,setLinks]=useState<{member:string;management:string|null}|null>(null);
 useEffect(()=>{void fetch('/identity/api').then(r=>r.json()).then((c:any)=>{if(c.enabled)setLinks({member:c.origins.member,management:c.management?.identityHref||null});}).catch(()=>{});},[]);
 return links?<nav aria-label="Account access" className={compact?'identity-shortcuts':'identity-links'}><a href={links.member+'/identity'}>Linked methods</a>{!compact&&links.management&&<a href={links.management}>Accounts &amp; sign-in</a>}</nav>:null;
}
