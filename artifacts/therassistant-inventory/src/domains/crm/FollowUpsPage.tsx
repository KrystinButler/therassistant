import { useEffect,useMemo,useState } from "react";
import { Link } from "wouter";
import { crmApi } from "./crm-api";
import type { CrmAccount } from "./types";

const money=(c:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(c/100);

function dayKey(value:Date){
  return new Date(value.getFullYear(),value.getMonth(),value.getDate()).getTime();
}

export function FollowUpsPage(){
 const [items,setItems]=useState<CrmAccount[]>([]);
 const [error,setError]=useState<string|null>(null);
 useEffect(()=>{void crmApi<{followUps:CrmAccount[]}>("follow-ups").then(r=>setItems(r.followUps)).catch(e=>setError(e instanceof Error?e.message:"Unable to load follow-ups."));},[]);

 const groups=useMemo(()=>{
   const today=dayKey(new Date());
   const overdue:CrmAccount[]=[];const dueToday:CrmAccount[]=[];const upcoming:CrmAccount[]=[];
   for(const account of items){
     if(!account.next_follow_up_at)continue;
     const due=dayKey(new Date(account.next_follow_up_at));
     if(due<today)overdue.push(account);
     else if(due===today)dueToday.push(account);
     else upcoming.push(account);
   }
   return {overdue,dueToday,upcoming};
 },[items]);

 function cards(list:CrmAccount[]){
   return list.map(a=>{
     const due=a.next_follow_up_at?new Date(a.next_follow_up_at):null;
     return <Link key={a.id} href={"/crm/accounts/"+a.id} className="crm-card crm-follow-card">
       <div><strong>{a.customer_name}</strong><div className="crm-muted">{a.account_number} · {money(a.currentBalanceCents)}</div></div>
       <span className="crm-due">{due?due.toLocaleString():""}</span>
     </Link>;
   });
 }

 return <section className="crm-stack">
   <div className="crm-page-head"><div><h1>Follow-Ups</h1><p>Accounts with a scheduled next contact.</p></div></div>
   {error&&<div className="crm-alert">{error}</div>}
   {groups.overdue.length>0&&<section className="crm-stack"><h2 className="crm-section-title overdue">Overdue</h2>{cards(groups.overdue)}</section>}
   {groups.dueToday.length>0&&<section className="crm-stack"><h2 className="crm-section-title">Today</h2>{cards(groups.dueToday)}</section>}
   {groups.upcoming.length>0&&<section className="crm-stack"><h2 className="crm-section-title">Upcoming</h2>{cards(groups.upcoming)}</section>}
   {!items.length&&<div className="crm-card crm-empty">No scheduled follow-ups.</div>}
 </section>;
}
