import {useEffect,useMemo,useState} from "react";
import type {PatientChart} from "../patients/types";
import {create90DayReview,getOutcomeWorkspace,recordOutcome,updateReviewDraft} from "./outcome-review-repository";
import {maxScore,outcomeTrend,type Instrument,type Measure,type Plan,type Visit} from "./outcome-review-model";

type Data=Awaited<ReturnType<typeof getOutcomeWorkspace>>;
function errorMessage(error:unknown){return error instanceof Error?error.message:"Unable to save clinical outcome data.";}
function fmt(value:unknown){return String(value??"");}
export function OutcomeReviewPanel({chart}:{chart:PatientChart}){
  const patientId=chart.patient.id;
  const [data,setData]=useState<Data|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [instrument,setInstrument]=useState<Instrument>("PHQ-9");
  const [score,setScore]=useState("");
  const [assessedOn,setAssessedOn]=useState(new Date().toISOString().slice(0,10));
  const [source,setSource]=useState<"clinician_entered"|"patient_reported">("clinician_entered");
  const [planId,setPlanId]=useState("");
  const [reviewDate,setReviewDate]=useState(new Date().toISOString().slice(0,10));
  const [draftId,setDraftId]=useState("");
  const [draftText,setDraftText]=useState("");
  async function refresh(){
    try{const result=await getOutcomeWorkspace(patientId);setData(result);setError(null);}
    catch(err){setError(errorMessage(err));}
    finally{setLoading(false);}
  }
  useEffect(()=>{setLoading(true);void refresh();},[patientId]);
  const measures=useMemo(()=>((data?.measures??[]) as unknown as Measure[]),[data]);
  const trends=useMemo(()=>["PHQ-9","GAD-7"].map(name=>({instrument:name as Instrument,trend:outcomeTrend(measures,name as Instrument)})),[measures]);
  const eligiblePlans=chart.treatmentPlans.filter(plan=>["active","signed","under_review"].includes(fmt(plan.status)));
  const selectedPlan=eligiblePlans.find(plan=>plan.id===planId)??eligiblePlans[0]??null;
  async function saveMeasure(){
    setSaving(true);setError(null);setMessage(null);
    try{
      if(score.trim()===""||!Number.isInteger(Number(score)))throw new Error("Enter a whole-number score.");
      await recordOutcome(patientId,{instrument,score:Number(score),assessedOn,source});
      setScore("");await refresh();setMessage(instrument+" assessment saved.");
    }catch(err){setError(errorMessage(err));}
    finally{setSaving(false);}
  }
  async function generate(){
    if(!selectedPlan||!data)return;
    setSaving(true);setError(null);setMessage(null);
    try{
      const row=await create90DayReview(patientId,selectedPlan as unknown as Plan,measures,data.visits as Visit[],reviewDate);
      setDraftId(row.id);setDraftText(fmt(row.draft_text));
      await refresh();setMessage("Editable review draft generated. The active treatment plan has not changed.");
    }catch(err){setError(errorMessage(err));}
    finally{setSaving(false);}
  }
  async function saveDraft(){
    if(!draftId)return;
    setSaving(true);setError(null);setMessage(null);
    try{await updateReviewDraft(draftId,draftText);await refresh();setMessage("Review draft saved. Clinician review and signature are still required.");}
    catch(err){setError(errorMessage(err));}
    finally{setSaving(false);}
  }
  return <div className="thera-stack" style={{marginTop:20}}>
    <div className="thera-card">
      <div className="thera-card-header"><div><div className="thera-eyebrow">MEASUREMENT-BASED CARE</div><h3>PHQ-9 and GAD-7</h3><p>Enter dated assessment totals. The system displays numerical changes without making a diagnosis or interpreting treatment response.</p></div></div>
      {error&&<div className="thera-state error" style={{marginBottom:12}}>{error}</div>}
      {message&&<div className="thera-alert" style={{marginBottom:12}}>{message}</div>}
      <div className="thera-form-grid">
        <label className="thera-field"><span className="thera-field-label">Instrument</span><select className="thera-input" value={instrument} onChange={e=>{setInstrument(e.target.value as Instrument);setScore("");}}><option>PHQ-9</option><option>GAD-7</option></select></label>
        <label className="thera-field"><span className="thera-field-label">Total Score (0–{maxScore(instrument)})</span><input className="thera-input" type="number" min="0" max={maxScore(instrument)} step="1" value={score} onChange={e=>setScore(e.target.value)}/></label>
        <label className="thera-field"><span className="thera-field-label">Assessment Date</span><input className="thera-input" type="date" value={assessedOn} onChange={e=>setAssessedOn(e.target.value)}/></label>
        <label className="thera-field"><span className="thera-field-label">Source</span><select className="thera-input" value={source} onChange={e=>setSource(e.target.value as "clinician_entered"|"patient_reported")}><option value="clinician_entered">Clinician entered</option><option value="patient_reported">Patient reported</option></select></label>
      </div>
      <div className="thera-filter-row" style={{marginTop:12}}><button type="button" className="thera-action" disabled={saving||score===""||!assessedOn} onClick={()=>void saveMeasure()}>Save Assessment</button></div>
      {loading?<div className="thera-state">Loading outcomes…</div>:<>
        <div className="thera-definition-grid" style={{marginTop:18}}>{trends.map(({instrument:name,trend})=><div key={name}><div className="thera-field-label">{name}</div><div className="thera-field-value">{trend?String(trend.last.score)+" / "+maxScore(name):"No assessments"}</div><div className="thera-table-subtext">{trend?(trend.count>1?"Change "+(trend.delta>0?"+":"")+trend.delta:"One assessment recorded"):"No trend available"}</div></div>)}</div>
        {measures.length?<div className="thera-table-wrap" style={{marginTop:12}}><table className="thera-table"><thead><tr><th>Date</th><th>Instrument</th><th>Score</th><th>Source</th></tr></thead><tbody>{measures.slice(0,20).map(row=><tr key={row.id}><td>{row.assessed_on}</td><td>{row.instrument}</td><td>{row.score} / {maxScore(row.instrument)}</td><td>{row.source==="patient_reported"?"Patient reported":"Clinician entered"}</td></tr>)}</tbody></table></div>:<div className="thera-empty">No outcome assessments recorded.</div>}
      </>}
    </div>
    <div className="thera-card">
      <div className="thera-card-header"><div><div className="thera-eyebrow">CLINICAL CONTINUITY</div><h3>90-Day Treatment Plan Review</h3><p>Create a draft from linked goals, recorded scores and signed-visit dates. Prior note narratives are not copied, and generating a review never alters the active plan.</p></div></div>
      <div className="thera-form-grid">
        <label className="thera-field"><span className="thera-field-label">Source Treatment Plan</span><select className="thera-input" value={selectedPlan?.id??""} onChange={e=>setPlanId(e.target.value)}><option value="">Select active plan</option>{eligiblePlans.map(plan=><option key={plan.id} value={plan.id}>{fmt(plan.problem_statement)||"Plan"} · {fmt(plan.effective_date)}</option>)}</select></label>
        <label className="thera-field"><span className="thera-field-label">Review Date</span><input className="thera-input" type="date" value={reviewDate} onChange={e=>setReviewDate(e.target.value)}/></label>
      </div>
      {!eligiblePlans.length&&<div className="thera-state">Create an active treatment plan first. Review generation does not block clinical work.</div>}
      <div className="thera-filter-row" style={{marginTop:12}}><button type="button" className="thera-action" disabled={saving||!data||!selectedPlan||!reviewDate} onClick={()=>void generate()}>Generate Editable Review Draft</button></div>
      {data?.reviews.length?<div style={{marginTop:16}}><div className="thera-field-label">Saved Review Drafts</div><div className="thera-filter-row" style={{flexWrap:"wrap"}}>{data.reviews.map(row=><button type="button" className="thera-action secondary" key={row.id} onClick={()=>{setDraftId(row.id);setDraftText(fmt(row.draft_text));}}>{fmt(row.review_date)} · Draft</button>)}</div></div>:null}
      {draftId&&<div style={{marginTop:14}}><div className="thera-field-label">Editable Clinical Review Draft — Not Signed</div><textarea className="thera-input" style={{minHeight:360,width:"100%"}} value={draftText} onChange={e=>setDraftText(e.target.value)}/><div className="thera-filter-row" style={{marginTop:10}}><button type="button" className="thera-action" disabled={saving||!draftText.trim()} onClick={()=>void saveDraft()}>Save Review Draft</button><span className="thera-table-subtext">Clinician review/signature is a separate step. Existing plan remains active.</span></div></div>}
    </div>
  </div>;
}
