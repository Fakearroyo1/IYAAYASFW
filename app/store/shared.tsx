'use client';
import {Input} from '@/components/ui/input';
export type Row=Record<string,any>;
export const money=(v:number|null|undefined)=>v==null?'Unknown':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v/100);
export const date=(v:number)=>new Date(v).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
export function Field({label,children,...props}:{label:string;children?:React.ReactNode;[key:string]:any}){return <label className="field"><span>{label}</span>{children||<Input {...(props.type==='datetime-local'?{step:1}:{})} {...props}/>}</label>}
export function NumberField({label,value,set,min=0,step='0.01'}:{label:string;value:string;set:(v:string)=>void;min?:number;step?:string}){return <Field label={label} type="number" min={min} step={step} value={value} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set(e.target.value)}/>}
