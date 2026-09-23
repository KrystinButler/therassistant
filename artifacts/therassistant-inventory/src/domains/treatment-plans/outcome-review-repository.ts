import { tenantInsert,tenantSelect,tenantUpdate,type Row } from "../../lib/tenant-data-client";
import { buildReviewDraft,maxScore,validateScore,type Instrument,type Measure,type Plan,type Visit } from "./outcome-review-model";
type DataRow=Row&{id:string};
export async function getOutcomeWorkspace(patientId:string){
  const [measures,reviews,visits]=await Promise.all([
    tenantSelect<DataRow>("clinical_outcome_measures",{client_id:"eq."+patientId,order:"assessed_on.desc,created_at.desc"}),
    tenantSelect<DataRow>("treatment_plan_review_drafts",{client_id:"eq."+patientId,order:"review_date.desc,created_at.desc"}),
    tenantSelect<DataRow>("clinical_notes",{client_id:"eq."+patientId,note_status:"in.(signed,locked)",select:"id,service_date,note_status",order:"service_date.asc"})
  ]);
  return {measures,reviews,visits};
}
export async function recordOutcome(patientId:string,input:{instrument:Instrument;score:number;assessedOn:string;source:"clinician_entered"|"patient_reported";notes?:string}){
  if(!validateScore(input.instrument,input.score))throw new Error(input.instrument+" score must be an integer from 0 to "+maxScore(input.instrument)+".");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.assessedOn))throw new Error("Assessment date is required.");
  return tenantInsert<DataRow>("clinical_outcome_measures",{
    client_id:patientId,instrument:input.instrument,score:input.score,assessed_on:input.assessedOn,source:input.source,notes:input.notes?.trim()||null
  });
}
export async function create90DayReview(patientId:string,plan:Plan,measures:Measure[],visits:Visit[],reviewDate:string){
  const {draftText,evidence}=buildReviewDraft({plan,measures,visits,reviewDate});
  return tenantInsert<DataRow>("treatment_plan_review_drafts",{
    client_id:patientId,source_plan_id:plan.id,provider_id:plan.provider_id||null,
    review_date:reviewDate,draft_text:draftText,evidence_snapshot:evidence,status:"draft"
  });
}
export function updateReviewDraft(id:string,text:string){
  if(!text.trim())throw new Error("Review draft cannot be blank.");
  return tenantUpdate<DataRow>("treatment_plan_review_drafts",id,{draft_text:text.trim()});
}
