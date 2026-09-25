import { useState } from "react";
import { FUNDING_SOURCE_OPTIONS, billingPathForFundingSource, billingPathLabel, fundingSubtypeOptions, type FundingSourceType } from "./funding-source";
import "./billing-responsibility-panel.css";
export type BillingFundingInput = {source:FundingSourceType;subtype:string;responsibleEntity:string;reference:string;notes:string};
type Encounter = {id:string;clientName:string;fundingSourceType:string;fundingSourceSubtype:string;funding_context?:unknown;billingPath:string};
export function BillingResponsibilityPanel({encounter,onSave,onCancel}:{encounter:Encounter;onSave:(input:BillingFundingInput)=>Promise<void>;onCancel:()=>void}) {
  const context=encounter.funding_context && typeof encounter.funding_context==="object"&&!Array.isArray(encounter.funding_context) ? encounter.funding_context as Record<string,unknown>:{};
  const initial = FUNDING_SOURCE_OPTIONS.some((item)=>item.id===encounter.fundingSourceType)?encounter.fundingSourceType as FundingSourceType:"insurance";
  const [source,setSource]=useState<FundingSourceType>(initial);
  const [subtype,setSubtype]=useState(encounter.fundingSourceSubtype);
  const [responsibleEntity,setResponsibleEntity]=useState(String(context.responsible_entity??""));
  const [reference,setReference]=useState(String(context.reference??""));
  const [notes,setNotes]=useState(String(context.notes??""));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError(null);
    try{await onSave({source,subtype,responsibleEntity,reference,notes});}
    catch(err){setError(err instanceof Error?err.message:"Unable to save billing responsibility.");}
    finally{setBusy(false);}
  }
  return <section className="thera-card billing-responsibility-panel" id="billing-responsibility-editor">
    <div className="thera-card-header"><div><div className="thera-eyebrow">BILLING WORKQUEUE</div><h2>Billing Responsibility</h2><p>{encounter.clientName} · Adjust funding for future charge routing only. Existing claims and signed clinical notes are not changed.</p></div></div>
    <form onSubmit={(e)=>void submit(e)} className="billing-responsibility-form">
      <label>Funding source<select className="thera-input" value={source} onChange={(e)=>{setSource(e.target.value as FundingSourceType);setSubtype("");}}>{FUNDING_SOURCE_OPTIONS.map((option)=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label>Funding subtype<select className="thera-input" value={subtype} onChange={(e)=>setSubtype(e.target.value)}><option value="">Not specified</option>{fundingSubtypeOptions(source).map((option)=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <div className="billing-responsibility-path"><strong>Billing path</strong><span>{billingPathLabel(billingPathForFundingSource(source))}</span></div>
      {source!=="insurance"&&<label>Responsible entity<input className="thera-input" value={responsibleEntity} onChange={(e)=>setResponsibleEntity(e.target.value)} placeholder="Patient, agency, program or contracting party" /></label>}
      {source!=="insurance"&&<label>Contract / reference<input className="thera-input" value={reference} onChange={(e)=>setReference(e.target.value)} /></label>}
      <label className="billing-responsibility-full">Billing notes<input className="thera-input" value={notes} onChange={(e)=>setNotes(e.target.value)} /></label>
      {error&&<div className="thera-state error billing-responsibility-full" role="alert">{error}</div>}
      <div className="thera-filter-row billing-responsibility-full"><button type="button" className="thera-action secondary" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="thera-action" disabled={busy}>{busy?"Saving…":"Save Billing Responsibility"}</button></div>
    </form>
  </section>;
}
