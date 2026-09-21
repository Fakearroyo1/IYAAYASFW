"use client";
import {useEffect,useState} from 'react';
export function IdentityLinks({compact=false}:{compact?:boolean}){
 const [links,setLinks]=useState<{member:string;admin:string}|null>(null);
 useEffect(()=>{void fetch('/identity/api').then(r=>r.json()).then((c:any)=>{if(c.enabled)setLinks(c.origins);}).catch(()=>{});},[]);
 return links?<nav aria-label="Account access" className={compact?'identity-shortcuts':'identity-links'}><a href={links.member+'/identity'}>Linked methods</a>{!compact&&<a href={links.admin+'/identity'}>Access management</a>}</nav>:null;
}
