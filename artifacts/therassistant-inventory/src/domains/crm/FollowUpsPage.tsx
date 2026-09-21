import { useEffect,useState } from "react";
import { Link } from "wouter";
import { crmApi } from "./crm-api";
import type { CrmAccount } from "./types";
const money=(c:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(c/100);
export function FollowUpsPage(){
 const [items,setItems]=useState<CrmAccount[]>([]); const [error,setError]=useState<string|null>(null);
 useEffect(()=>{void crmApi<{followUps:CrmAccount[]}>("follow-ups").then(r=>setItems(r.followUps)).catch(e=>setError(e instanceof Error?e.message:"Unable to load follow-ups."));},[]);
 const now=Date.now();
 return <section className="crm-stack"><div className="crm-page-head"><div><h1>Follow-Ups</h1><p>Accounts with a scheduled next contact.</p></div></div>
 {error&&<div className="crm-alert">{error}</div>}
 {items.map(a=>{const due=a.next_follow_up_at?new Date(a.next_follow_up_at):null;const overdue=due?due.getTime()<now:false;return <Link key={a.id} href={"/crm/accounts/"+a.id} className="crm-card crm-follow-card"><div><strong>{a.customer_name}</strong><div className="crm-muted">{a.account_number} · {money(a.currentBalanceCents)}</div></div><span className={overdue?"crm-due overdue":"crm-due"}>{due?due.toLocaleString():""}</span></Link>})}
 {!items.length&&<div className="crm-card crm-empty">No scheduled follow-ups.</div>}</section>;
}
