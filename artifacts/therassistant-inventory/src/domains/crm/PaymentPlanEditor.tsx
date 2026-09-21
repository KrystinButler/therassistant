import { useState } from "react";
import { crmApi } from "./crm-api";
import type { CrmAccount,CrmPlanBundle } from "./types";

const iso=(d:Date)=>d.toISOString().slice(0,10);

export function PaymentPlanEditor({account,bundle,onClose,onSaved}:{account:CrmAccount;bundle:CrmPlanBundle;onClose():void;onSaved():Promise<void>|void}){
 const p=bundle.plan;
 const [frequency,setFrequency]=useState<"weekly"|"biweekly"|"monthly">(p?.frequency||"monthly");
 const [installment,setInstallment]=useState(p?(p.installment_cents/100).toFixed(2):"");
 const [downPayment,setDownPayment]=useState(p?(p.down_payment_cents/100).toFixed(2):"0.00");
 const [firstDate,setFirstDate]=useState(p?.first_installment_date||iso(new Date(Date.now()+86400000)));
 const [grace,setGrace]=useState(String(p?.grace_period_days||0));
 const [terms,setTerms]=useState(p?.special_terms||"");
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);

 async function save(e:React.FormEvent){
   e.preventDefault();
   const installmentCents=Math.round(Number(installment)*100);
   const downPaymentCents=Math.round(Number(downPayment||0)*100);
   if(!Number.isInteger(installmentCents)||installmentCents<1){setMessage("Enter a valid installment amount.");return;}
   if(!Number.isInteger(downPaymentCents)||downPaymentCents<0){setMessage("Enter a valid down payment.");return;}
   setBusy(true);
   try{
     if(p){
       await crmApi("modify-plan",{method:"POST",body:{
         planId:p.id,
         frequency,
         installmentCents,
         firstInstallmentDate:firstDate,
         gracePeriodDays:Number(grace||0),
         specialTerms:terms,
         status:p.status,
       }});
     }else{
       await crmApi("create-plan",{method:"POST",body:{
         accountId:account.id,
         downPaymentCents,
         frequency,
         installmentCents,
         firstInstallmentDate:firstDate,
         gracePeriodDays:Number(grace||0),
         specialTerms:terms,
         status:"draft",
       }});
     }
     await onSaved();
     onClose();
   }catch(err){
     setMessage(err instanceof Error?err.message:"Unable to save payment plan.");
   }finally{
     setBusy(false);
   }
 }

 return <div className="crm-modal-backdrop"><form className="crm-modal" onSubmit={save}>
   <div className="crm-row-between"><h2>{p?"Modify Payment Plan":"Create Payment Plan"}</h2><button type="button" onClick={onClose}>Close</button></div>
   <div className="crm-muted">Current account balance: {new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(account.currentBalanceCents/100)}</div>
   {!p&&<label>Down payment<input inputMode="decimal" value={downPayment} onChange={e=>setDownPayment(e.target.value)}/></label>}
   <label>Frequency<select value={frequency} onChange={e=>setFrequency(e.target.value as "weekly"|"biweekly"|"monthly")}><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option></select></label>
   <label>Regular installment<input required inputMode="decimal" value={installment} onChange={e=>setInstallment(e.target.value)}/></label>
   <label>First payment date<input required type="date" value={firstDate} onChange={e=>setFirstDate(e.target.value)}/></label>
   <label>Grace period (days)<input type="number" min="0" max="90" value={grace} onChange={e=>setGrace(e.target.value)}/></label>
   <label>Special terms<textarea value={terms} onChange={e=>setTerms(e.target.value)}/></label>
   <div className="crm-muted">Changes to an existing plan create a new plan version and require a revised agreement.</div>
   {message&&<div className="crm-alert">{message}</div>}
   <button className="crm-primary" disabled={busy}>{busy?"Saving…":p?"Save Revised Plan":"Create Plan"}</button>
 </form></div>;
}
