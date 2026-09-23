import { tenantInsert,tenantRpc,tenantSelect,tenantUpdate,type Row } from "../../lib/tenant-data-client";
import { buildReviewDraft,maxScore,validateScore,type Instrument,type Measure,type Plan,type Visit } from "./outcome-review-model";
type DataRow=Row&{id:string};
export async function getOutcomeWorkspace(patientId:string){
  const [measures,reviews,visits,signatures]=await Promise.all([
    tenantSelect<DataRow>("clinical_outcome_measures",{client_id:"eq."+patientId,order:"assessed_on.desc,created_at.desc"}),
    tenantSelect<DataRow>("treatment_plan_review_drafts",{client_id:"eq."+patientId,order:"review_date.desc,created_at.desc"}),
    tenantSelect<DataRow>("clinical_notes",{client_id:"eq."+patientId,note_status:"in.(signed,locked)",select:"id,service_date,note_status",order:"service_date.asc"}),
    tenantSelect<DataRow>("treatment_plan_review_signatures",{client_id:"eq."+patientId,order:"signed_at.desc"})
  ]);
  return {measures,reviews,visits,signatures};
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


export type ReviewSignatureReadiness = {
  can_sign: boolean;
  reason: "ready" | "already_signed" | "provider_required" | "clinician_role_required" | "provider_not_linked" | "email_mismatch" | string;
  signed: boolean;
  signed_at?: string | null;
  provider_id?: string | null;
  provider_name?: string | null;
  clinician_role?: boolean;
  linked?: boolean;
  email_match?: boolean;
};

export function getReviewSignatureReadiness(reviewDraftId:string){
  return tenantRpc<ReviewSignatureReadiness>("review_signature_readiness",{
    p_review_draft_id:reviewDraftId
  });
}

export function linkCurrentUserToProvider(providerId:string){
  return tenantRpc<{linked:boolean;provider_id:string;provider_name:string}>("link_current_user_to_provider",{
    p_provider_id:providerId
  });
}

export function signTreatmentPlanReview(reviewDraftId:string,signatureText:string,attestationAccepted:boolean){
  if(!signatureText.trim())throw new Error("Type your signature before signing.");
  if(!attestationAccepted)throw new Error("Accept the clinician attestation before signing.");
  return tenantRpc<{signed:boolean;signature_id:string;signed_at:string;provider_name:string}>("sign_treatment_plan_review",{
    p_review_draft_id:reviewDraftId,
    p_signature_text:signatureText.trim(),
    p_attestation_accepted:attestationAccepted
  });
}
