import { useEffect, useState } from "react";
import { Link } from "wouter";
import { crmApi } from "./crm-api";
import type { CrmAccess, CrmAccount } from "./types";

const money=(cents:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);

export function AccountsPage({access}:{access:CrmAccess}) {
  const [accounts,setAccounts]=useState<CrmAccount[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [showNew,setShowNew]=useState(false);
  const [form,setForm]=useState({customerName:"",originalBalance:"",phone:"",email:""});
  const load=()=>crmApi<{accounts:CrmAccount[]}>("accounts").then(r=>setAccounts(r.accounts)).catch(e=>setError(e instanceof Error?e.message:"Unable to load accounts."));
  useEffect(()=>{void load();},[]);
  async function createAccount(e:React.FormEvent){
    e.preventDefault();
    const cents=Math.round(Number(form.originalBalance)*100);
    try{
      await crmApi("create-account",{method:"POST",body:{customerName:form.customerName,originalBalanceCents:cents,phone:form.phone,email:form.email}});
      setShowNew(false);setForm({customerName:"",originalBalance:"",phone:"",email:""});await load();
    }catch(err){setError(err instanceof Error?err.message:"Unable to create account.");}
  }
  return <section className="crm-stack">
    <div className="crm-page-head"><div><h1>Collection Accounts</h1><p>Open an account to log calls, documents, plans, and payments.</p></div>{access.role==="admin"&&<button className="crm-primary" onClick={()=>setShowNew(!showNew)}>New Account</button>}</div>
    {error&&<div className="crm-alert">{error}</div>}
    {showNew&&<form className="crm-card crm-form-grid" onSubmit={createAccount}>
      <label>Customer name<input required value={form.customerName} onChange={e=>setForm({...form,customerName:e.target.value})}/></label>
      <div className="crm-muted">An internal CRM account number will be assigned automatically.</div><label>Original balance<input required inputMode="decimal" value={form.originalBalance} onChange={e=>setForm({...form,originalBalance:e.target.value})}/></label>
      <label>Phone<input type="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
      <label>Email<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
      <div className="crm-form-actions"><button className="crm-primary" type="submit">Create Account</button><button type="button" onClick={()=>setShowNew(false)}>Cancel</button></div>
    </form>}
    <div className="crm-account-grid">{accounts.map(a=><Link key={a.id} href={"/crm/accounts/"+a.id} className="crm-account-card">
      <div className="crm-account-card-top"><strong>{a.customer_name}</strong><span className={"crm-status "+a.status}>{a.status.replace("_"," ")}</span></div>
      <div className="crm-balance">{money(a.currentBalanceCents)}</div><div className="crm-muted">Account {a.account_number}</div>
      <div className="crm-account-meta"><span>Original {money(a.originalBalanceCents)}</span><span>{a.next_follow_up_at?"Follow-up "+new Date(a.next_follow_up_at).toLocaleDateString():"No follow-up set"}</span></div>
    </Link>)}</div>
    {!accounts.length&&<div className="crm-card crm-empty">No CRM accounts yet.</div>}
  </section>;
}
