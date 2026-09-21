"use client";
import { NativeSelect } from "@/components/ui/native-select";
import "./experience.css";

export const adminGroups = [
  { title: "Start here", items: [["overview", "Dashboard"], ["attention", "Needs attention"]] },
  { title: "Money", items: [["payments", "Confirm payments"], ["transactions", "Transactions & corrections"], ["month", "Month close"]] },
  { title: "Products & orders", items: [["inventory", "Products & stock"], ["planning", "Restock & counts"], ["pricing", "Pricing"], ["pickups", "Fulfillment"], ["guest", "Guest campaigns"], ["trials", "Trials & interest"]] },
  { title: "Members & community", items: [["members", "Members & access"], ["access", "Email changes"], ["rewards", "Murley Bucks & profiles"], ["community", "Community moderation"]] },
  { title: "Store operations", items: [["team", "Team board"], ["activity", "Activity history"], ["settings", "Store settings"]] },
] as const;

export default function AdminNavigation({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  const groups=adminGroups;
  return <>
    <label className="management-select field"><span>Management section</span><NativeSelect value={value} onChange={e=>onChange(e.target.value)}>
      {groups.map(group=><optgroup label={group.title} key={group.title}>{group.items.map(([id,label])=><option key={id} value={id}>{label}</option>)}</optgroup>)}
    </NativeSelect></label>
    <nav className="management-nav" aria-label="Store management">
      {groups.map(group=><div className="management-group" key={group.title}><span>{group.title}</span><div>{group.items.map(([id,label])=><button type="button" key={id} aria-current={value===id?"page":undefined} onClick={()=>onChange(id)}>{label}</button>)}</div></div>)}
    </nav>
  </>;
}
