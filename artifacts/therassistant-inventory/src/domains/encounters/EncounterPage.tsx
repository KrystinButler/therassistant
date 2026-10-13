import { ClinicianSigningSetup } from "../clinical/ClinicianSigningSetup";
import { TelehealthVisit } from "../scheduling/TelehealthVisit";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import {
  addEncounterDiagnosis,
  addEncounterServiceLine,
  updateEncounterServiceLine,
  removeEncounterServiceLine,
  voidPreclaimServiceLine,
  saveClinicalNote,
  signEncounterNote,
  applyCrossSystemDiagnosisSequence,
  rejectCrossSystemCodingRecommendation,
} from "../clinical/repository";
import { buildPatientReviewCheckIn } from "../scheduling/patient-review-model";
import { treatmentPlanAlert } from "../treatment-plans/workflow";
import { getTreatmentPlanWorkspace } from "../treatment-plans/repository";
import { EncounterTreatmentPlanComposer } from "../treatment-plans/EncounterTreatmentPlanComposer";
import { FastChartingPanel } from "../clinical/FastChartingPanel";
import { SessionTimelinePanel } from "../clinical/SessionTimelinePanel";
import { noteDraftFingerprint } from "../clinical/note-section-editing";
import { ClinicalNoteWorkspace } from "../clinical/ClinicalNoteWorkspace";
import { getPsychotherapyNote, savePsychotherapyNote } from "../clinical/psychotherapy-note-repository";
import { createSmartPhrase, getFastChartingContext, getSmartPhrases } from "../clinical/fast-charting-repository";
import { clinicalNoteSimilarity, emptyStructuredSelections, expandSmartPhraseAtCursor, synthesizeStructuredNarrative, type PriorStructuredContext, type SmartPhrase, type StructuredSelections } from "../clinical/fast-charting";
import { forensicContextForCarryForward } from "../clinical/forensic-context";
import { psychedelicContextForCarryForward } from "../clinical/psychedelic-context";
import { Icd10SearchInput } from "../coding/Icd10SearchInput";
import { normalizedServiceLine, matchingServiceLineExists } from "./service-line-validation";
import { ProcedureCodeSearchInput } from "../coding/ProcedureCodeSearchInput";
import { PlaceOfServiceSearchInput } from "../coding/PlaceOfServiceSearchInput";
import {
  FUNDING_SOURCE_OPTIONS,
  billingPathForFundingSource,
  billingPathLabel,
  fundingSubtypeOptions,
  resolveEncounterFunding,
  type FundingSourceType,
} from "../billing/funding-source";
import {
  appendClinicalSource,
  buildClinicalSourceProvenance,
  buildJournalNoteInsert,
  buildPreVisitNoteInsert,
  latestSharedJournalEntry,
  withClinicalSourceImport,
} from "./clinical-source-context";
import { getEncounterDetail, updateEncounter } from "./repository";
import { createChargeFromEncounter, routeEncounterToBilling } from "../billing/repository";
import { scheduledSessionTime } from "./scheduled-session-time";
import { noteTypeForService } from "./service-note-template";
import { appendImportedText, evaluateCrossSystemEngine, sanitizeImportedText } from "../clinical/cross-system-engine";
import "./encounter-page.css";

type EncounterDetail = Awaited<ReturnType<typeof getEncounterDetail>>;
type ContextTab = "lastVisit" | "treatment" | "journal" | "documents";
const noteLayouts: Record<string, { title: string; sections: string[] }> = {
 psychotherapy: { title: "Psychotherapy Progress Note", sections: ["Session focus", "Interventions", "Patient response", "Progress toward goals", "Risk assessment", "Plan"] },
 assessment: { title: "Clinical Assessment", sections: ["Presenting concerns", "History", "Mental status", "Diagnostic assessment", "Risk / safety", "Recommendations"] },
 intake: { title: "Intake Note", sections: ["Chief concern", "History", "Psychosocial context", "Mental status", "Risk / safety", "Initial plan"] },
 crisis: { title: "Crisis Note", sections: ["Presenting crisis", "Safety assessment", "Immediate interventions", "Response", "Disposition", "Safety plan"] },
 case_management: { title: "Case Management Note", sections: ["Service need", "Care coordination", "Resources", "Response", "Follow-up"] },
 medication_management: { title: "Medication Management Note", sections: ["Symptoms", "Adherence", "Side effects", "Mental status", "Risk assessment", "Medication plan"] },
 other: { title: "Clinical Note", sections: ["Reason for visit", "Findings", "Intervention", "Response", "Plan"] },
};
function personName(row?: Record<string, any> | null) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function defaultPos(location?: string | null) {
  return location === "telehealth" || location === "phone" ? "02" : "11";
}

function appointmentDuration(appointment?: Record<string, any> | null) {
  return scheduledSessionTime(appointment)?.minutes ?? 0;
}

function displayText(row: Record<string, any> | null | undefined, keys: string[], fallback = "—") {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

export function EncounterPage() {
  const [, params] = useRoute<{ id: string }>("/encounters/:id");
  const encounterId = params?.id ?? "";
  const [data, setData] = useState<EncounterDetail | null>(null);
  const [contextTab, setContextTab] = useState<ContextTab>("lastVisit");
  const [contextOpen, setContextOpen] = useState(true);
  const [planComposer, setPlanComposer] = useState<{ mode: "plan" | "goal"; planId?: string } | null>(null);
  const [focusedTreatmentPlanId, setFocusedTreatmentPlanId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showPhraseMenu, setShowPhraseMenu] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const signatureRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useStat…8291 tokens truncated…={{ marginBottom: 12 }}>{message}</div>}

      <div className="encounter-console">
        <section className="thera-card encounter-note-card">
          <div className="thera-card-header">
            <div><div className="thera-eyebrow">DOCUMENT</div><h2>Active Progress Note</h2><p>Keep documentation open while reviewing clinical context.</p></div>
            {note && <StatusBadge value={String(note.note_status)} />}
          </div>
          {data.appointment?.location_type === "telehealth" && <div className="encounter-live-session"><TelehealthVisit appointment={data.appointment} editable /></div>}
          <div className="encounter-documentation-column">
          <div className="encounter-note-controls">
            <label><div className="thera-field-label">Note Type</div><select className="thera-input" value={noteType} disabled={signed || saving} onChange={(event) => changeNoteType(event.target.value)}><option value="psychotherapy">Psychotherapy</option><option value="assessment">Assessment</option><option value="intake">Intake</option><option value="crisis">Crisis</option><option value="case_management">Case Management</option><option value="medication_management">Medication Management</option><option value="other">Other</option></select></label>
            <label><div className="thera-field-label">Treatment Plan — Goal / Objective</div><select className="thera-input" value={goalAddressed} disabled={signed || saving} onChange={(event) => setGoalAddressed(event.target.value)}><option value="">Select a goal</option>{activeGoals.map((goal) => { const label = displayText(goal, ["goal_text", "description", "goal", "title"], "Goal"); return <option key={goal.id} value={label}>{label}</option>; })}{goalAddressed && !activeGoals.some((goal) => displayText(goal, ["goal_text", "description", "goal", "title"], "Goal") === goalAddressed) && <option value={goalAddressed}>{goalAddressed} (previous selection)</option>}</select>{activeGoals.length === 0 && <small>No linked treatment-plan goals. <button type="button" className="encounter-goal-create-link" onClick={() => { setContextTab("treatment"); setContextOpen(true); setPlanComposer(currentTreatmentPlan ? { mode: "goal", planId: String(currentTreatmentPlan.id) } : { mode: "plan" }); }}>Create a treatment plan or goal →</button></small>}</label>
          </div>
          {renderClinicalWorkspace("editor")}
          <SessionTimelinePanel signed={signed || saving} selections={structuredSelections} onSelectionsChange={setStructuredSelections} onInsertPhrase={injectIntoNote} />
          <details className="encounter-structured-tools"><summary>Structured findings &amp; SmartPhrase library</summary>
            <FastChartingPanel signed={signed || saving} noteType={noteType} phrases={smartPhrases}
              selections={structuredSelections} generatedNarrative={generatedNarrative}
              priorContext={priorStructuredContext} noteSimilarity={noteSimilarity}
              onSelectionsChange={setStructuredSelections}
              onInsertNarrative={() => injectIntoNote(generatedNarrative)} onInsertPhrase={injectIntoNote}
              onCarryForward={carryForwardStructured} onCreatePhrase={addSmartPhrase} />
          </details>
          <div className="encounter-editor-surface">
            <div className="encounter-editor-heading">
              <div><div className="thera-eyebrow">CLINICAL DOCUMENTATION</div><label htmlFor="encounter-progress-note-editor">{noteLayout.title}</label></div>
              <span className={signed ? "encounter-editor-status signed" : noteHasUnsavedText ? "encounter-editor-status unsaved" : "encounter-editor-status"}>
                {signed ? "Signed · Read only" : noteHasUnsavedText ? "Unsaved changes" : "Draft"}
              </span>
            </div>
            <div className="encounter-previsit-import" aria-label="Patient pre-visit check-in">
              <div className="encounter-previsit-import-copy">
                <span className="thera-eyebrow">PATIENT-REPORTED · PRE-VISIT CHECK-IN</span>
                <strong>{preVisit.hasSubmittedPreVisit ? "Submitted patient answers" : "No check-in submitted for this visit"}</strong>
                <p>{preVisit.hasSubmittedPreVisit ? "Import the patient's own responses with source attribution. Review and edit before signing." : "A submitted check-in linked to this appointment will appear here."}</p>
                {preVisit.hasSubmittedPreVisit && <details className="encounter-previsit-preview"><summary>Preview patient answers</summary>
                  <div className="encounter-previsit-answers">
                    {preVisit.focus && <div><strong>Focus</strong><span>{preVisit.focus}</span></div>}
                    {preVisit.mood && <div><strong>Since last visit</strong><span>{preVisit.mood}</span></div>}
                    {preVisit.changes.length > 0 && <div><strong>Important changes</strong><span>{preVisit.changes.join("; ")}</span></div>}
                    {preVisit.safetyText && <div><strong>Patient's safety response</strong><span>{preVisit.safetyText}</span></div>}
                    {preVisit.treatmentGoal && <div><strong>Patient's goal</strong><span>{preVisit.treatmentGoal}</span></div>}
                    {preVisit.additionalContext && <div><strong>Additional context</strong><span>{preVisit.additionalContext}</span></div>}
                  </div>
                </details>}
              </div>
              <button type="button" className={preVisitAlreadyImported ? "thera-action secondary" : "thera-action"}
                disabled={signed || !preVisitInsert || preVisitAlreadyImported} onClick={importPreVisit}>
                {preVisitAlreadyImported ? "Answers imported" : "Import Answers into Note"}
              </button>
            </div>
            {crossSystemEvaluation.matchedRules.length > 0 && !signed && <div className="cross-system-smartphrases"><div><strong>Suggested SmartPhrases</strong><span>Matched to current documentation; insertion is always clinician-controlled.</span></div><div>{crossSystemEvaluation.matchedRules.map((rule) => <button type="button" className="thera-action secondary" key={rule.id} title={rule.category} onClick={() => setNoteText((current) => appendImportedText(current, rule.macroText))}>{rule.dotPhrase}</button>)}</div></div>}
          <div className="encounter-editor-toolbar" role="toolbar" aria-label="Progress note writing tools">
              <div className="encounter-section-tools">
                <span className="encounter-tool-label">Insert section</span>
                <div className="encounter-section-buttons">
                  {noteLayout.sections.map((section) => <button type="button" key={section} className="encounter-insert-chip" disabled={signed || saving} onClick={() => insertNoteSection(section)} title={`Insert ${section} heading at the cursor`}>{section}</button>)}
                </div>
              </div>
              <div className="encounter-phrase-control">
                <button type="button" className="encounter-phrase-trigger" disabled={signed || saving} aria-expanded={showPhraseMenu} aria-controls="encounter-smartphrase-quick-menu" onClick={() => setShowPhraseMenu((open) => !open)}>
                  SmartPhrases <span>{smartPhrases.length}</span> <span aria-hidden="true">▾</span>
                </button>
                {showPhraseMenu && !signed && <div id="encounter-smartphrase-quick-menu" className="encounter-phrase-menu" role="group" aria-label="Insert a SmartPhrase">
                  <div className="encounter-phrase-menu-heading">Insert at cursor</div>
                  {smartPhrases.length ? smartPhrases.map((phrase) => <button type="button" key={phrase.id} title={phrase.label} onClick={() => insertEditorPhrase(phrase.content)}><strong>{phrase.label}</strong><span>{phrase.shortcut}</span></button>) : <p>No SmartPhrases available. Create one in the library below.</p>}
                </div>}
              </div>
            </div>
            <div className="encounter-editor-wrap">
              <textarea id="encounter-progress-note-editor" ref={noteRef} className="thera-input encounter-note-editor" value={noteText} disabled={signed || saving} aria-describedby="encounter-progress-note-hint" onChange={(event) => handleNoteChange(event.target.value, event.target.selectionStart)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (!saving && !signed && noteText.trim()) void saveNote(); } }} placeholder={`Document the ${noteLayout.title.toLowerCase()} here. Use Insert section to structure your note.`} spellCheck />
              {showSlashMenu && !signed && <div className="encounter-slash-menu"><div>QUICK INSERTS</div><button type="button" onClick={() => injectQuickText("Risk Assessment (clinician-confirmed):\nSuicidal ideation: [assess and document]\nHomicidal ideation: [assess and document]\nRelevant risks and protective factors: [document findings]\nSafety plan or follow-up, if indicated: [document]")}>Risk: Assessment Template</button><button type="button" onClick={() => injectQuickText("Mental Status Examination (clinician-confirmed):\nAppearance / behavior: [observed]\nOrientation: [assessed]\nSpeech: [observed]\nThought process and content: [assessed]\nMood and affect: [assessed]\nOther relevant findings: [document]")}>MSE: Findings Template</button><button type="button" onClick={() => injectQuickText("Intervention: Supportive psychotherapy, reflective listening, validation, and collaborative problem solving were utilized.")}>Intervention: Supportive</button></div>}
            </div>
            <div className="encounter-editor-footer">
              <div id="encounter-progress-note-hint" className="encounter-editor-meta"><strong>{noteWordCount} words</strong><span aria-hidden="true">·</span><span>Type / for quick inserts</span><span aria-hidden="true">·</span><span>{signed ? "Signed note is locked" : "Save to keep your draft"}</span></div>
              {!signed && <button type="button" className="thera-action encounter-editor-save" disabled={saving || !noteText.trim()} onClick={() => void saveNote()}>{saving ? "Saving..." : "Save Note"}</button>}
            </div>
            <div className="encounter-inline-signature" id="encounter-signature">
              {signed ? <div className="encounter-signed-handoff"><div><strong>Signed clinical record → Charge Capture</strong><span>The note is locked. All claim and charge corrections remain available in revenue-cycle workqueues.</span></div><Link href="/billing/charges" className="thera-action secondary">Open Charge Capture</Link></div> : <>
                <ClinicianSigningSetup providerId={String(data.encounter.provider_id ?? "")} />
                <div className="encounter-sign-row"><label><span className="thera-field-label">Rendering Provider Signature</span><input ref={signatureRef} disabled={saving} className="thera-input" value={signatureText} onChange={(event) => setSignatureText(event.target.value)} placeholder="Provider signature" /></label>
                  <button type="button" className="thera-action" disabled={saving || noteHasUnsavedText || !noteText.trim() || !signatureText.trim()} onClick={() => void sign()}>{saving ? "Signing…" : "Sign & Lock Note"}</button></div>
                {!noteText.trim() && <button type="button" className="thera-action secondary" onClick={() => { noteRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); noteRef.current?.focus({ preventScroll: true }); }}>Go to Note Editor</button>}
                <p className="thera-table-subtext" role="status">{noteHasUnsavedText ? "Save your changes before signing. " : ""}Save Note stores the clinical draft. Sign & Lock signs only the saved note. Diagnosis, coding, and eligibility issues are handled in billing workflow and do not block clinical signature.</p>
              </>}
            </div>
          </div>
          {signed && data.signatures[0] && <div className="thera-alert" style={{ marginTop: 12 }}>Signed {dateTime(String(data.signatures[0].signed_at ?? ""))} by {String(data.signatures[0].signature_text ?? "provider")}</div>}
          </div>
          <aside className="encounter-patient-context">{renderClinicalWorkspace("context")}</aside>
        </section>
        <aside className={contextOpen ? "encounter-context-rail open" : "encounter-context-rail"}>
          <div className="encounter-context-tabs" role="group" aria-label="Clinical context">
            <ContextButton active={contextTab === "lastVisit"} label="Last Visit" short="LV" onClick={() => { setContextTab("lastVisit"); setContextOpen(true); }} />
            <ContextButton active={contextTab === "treatment"} label="Treatment Plan" short="TP" onClick={() => { setContextTab("treatment"); setContextOpen(true); }} />
            <ContextButton active={contextTab === "journal"} label="Journal" short="JR" onClick={() => { setContextTab("journal"); setContextOpen(true); }} />
            <ContextButton active={contextTab === "documents"} label="Documents" short="DC" onClick={() => { setContextTab("documents"); setContextOpen(true); }} />
            <button type="button" className="encounter-context-collapse" onClick={() => setContextOpen((open) => !open)} aria-label={contextOpen ? "Collapse clinical context" : "Expand clinical context"}>{contextOpen ? "›" : "‹"}</button>
          </div>
          {contextOpen && <div className="encounter-context-content">
            {contextTab === "lastVisit" && <><div className="encounter-context-heading"><div><span>LAST VISIT</span><h3>Prior Session Context</h3></div></div><div className="encounter-context-section"><Field label="Current visit focus" value={visitFocus} /><Field label="Goal / objective" value={goalAddressed || activeGoalText || "—"} />{preVisit.hasSubmittedPreVisit && <div className="encounter-context-source"><strong>Pre-Visit Check-In</strong>{preVisit.focus && <p>{preVisit.focus}</p>}{preVisit.mood && <small>Since last visit: {preVisit.mood}</small>}{!signed && preVisitInsert && <button type="button" className="thera-action secondary" onClick={importPreVisit} disabled={preVisitAlreadyImported}>{preVisitAlreadyImported ? "Imported" : "Cite Check-In"}</button>}</div>}<div className="encounter-context-source"><strong>Previous clinical note</strong><p>{data.notes.length > 1 ? String(data.notes[1]?.note_text ?? "No prior note text available.") : "No earlier signed note is available in this encounter record."}</p></div></div></>}
            {contextTab === "treatment" && <><div className="encounter-context-heading encounter-plan-heading" id="encounter-treatment-plans"><div><span>GOLDEN THREAD</span><h3>Treatment Plan</h3></div><div className="encounter-plan-heading-actions">{treatmentPlanReadiness && <StatusBadge value={treatmentPlanReadiness.code} />}<button type="button" className="thera-action secondary" aria-label="Create treatment plan for this patient" onClick={() => setPlanComposer({ mode: "plan" })}>+ New Plan</button></div></div><div className="encounter-context-section encounter-treatment-section">
                {data.treatmentPlans.length > 1 && <label className="encounter-plan-switcher">Select plan<select className="thera-input" value={String(currentTreatmentPlan?.id ?? "")} onChange={(event) => setFocusedTreatmentPlanId(event.target.value)}>{data.treatmentPlans.map((plan) => <option value={String(plan.id)} key={String(plan.id)}>{String(plan.plan_text ?? "Treatment Plan").slice(0, 58)} · {String(plan.status ?? "draft")}</option>)}</select></label>}
                {currentTreatmentPlan ? <div className="encounter-context-source"><strong>{String(currentTreatmentPlan.plan_text ?? "Treatment plan")}</strong><small>Effective {shortDate(String(currentTreatmentPlan.effective_date ?? ""))} · {String(currentTreatmentPlan.status ?? "draft").replaceAll("_", " ")}</small>{Boolean(currentTreatmentPlan.review_due_date) && <small>Review due {shortDate(String(currentTreatmentPlan.review_due_date))}</small>}</div> : <div className="thera-empty">No treatment plan on file. Create a draft here without leaving the encounter.</div>}
                {activeGoals.map((goal) => { const goalText = displayText(goal, ["goal_text", "description", "goal", "title"], "Goal"); return <div className="encounter-context-goal" key={goal.id}><div><strong>{goalText}</strong><small>{String(goal.goal_status ?? goal.status ?? "active").replaceAll("_", " ")}</small></div>{!signed && <button type="button" onClick={() => injectIntoNote(`\nProgress regarding treatment goal: ${goalText}\nIntervention: \nPatient response/progress: \n`)}>Cite →</button>}</div>; })}
                {!activeGoals.length && currentTreatmentPlan && <p className="encounter-plan-empty">No goals recorded for the current plan.</p>}
                {currentTreatmentPlan && <button type="button" className="thera-action secondary encounter-add-plan-goal" onClick={() => setPlanComposer({ mode: "goal", planId: String(currentTreatmentPlan.id) })}>+ Add Goal / Objective</button>}
                {planComposer && <EncounterTreatmentPlanComposer key={planComposer.mode + (planComposer.planId ?? "")} mode={planComposer.mode} existingPlanId={planComposer.planId} patientId={String(encounter.client_id)} defaultProviderId={String(encounter.provider_id ?? "")} serviceDate={serviceDate} onCancel={() => setPlanComposer(null)} onPlanPersisted={async (planId) => { await refreshEncounterTreatmentPlans(undefined, planId); }} onSaved={async (planId, goalText) => { await refreshEncounterTreatmentPlans(goalText, planId); setPlanComposer(null); }} />}
              </div></>}
            {contextTab === "journal" && <><div className="encounter-context-heading"><div><span>PATIENT CONTEXT</span><h3>Journal</h3></div></div><div className="encounter-context-section">{sharedJournal ? <div className="encounter-context-source"><Field label="Entry Date" value={shortDate(String(sharedJournal.entry_date ?? sharedJournal.created_at ?? ""))} /><p>{String(sharedJournal.entry_text ?? "")}</p>{!signed && journalInsert && <button type="button" className="thera-action secondary" onClick={importJournal}>Cite Journal</button>}</div> : <div className="thera-empty">No journal entry is shared with the provider.</div>}</div></>}
            {contextTab === "documents" && <><div className="encounter-context-heading"><div><span>CHART CONTEXT</span><h3>Documents</h3></div></div><div className="encounter-context-section">{data.documents.length ? data.documents.slice(0,12).map((document) => <div className="encounter-document-row" key={document.id}><div><strong>{String(document.file_name ?? "Document")}</strong><small>{String(document.document_type ?? "other").replaceAll("_", " ")} · {shortDate(String(document.created_at ?? ""))}</small></div><StatusBadge value={String(document.document_status ?? "uploaded")} /></div>) : <div className="thera-empty">No patient documents are indexed.</div>}<Link href={`/clients/${String(encounter.client_id)}`} className="thera-action secondary">Open Patient Documents</Link></div></>}
          </div>}
        </aside>
      </div>

      <div className="encounter-lower-grid">
        <section className="thera-card" id="encounter-diagnoses"><div className="thera-card-header"><div><div className="thera-eyebrow">CLINICAL CONTEXT</div><h2>Diagnoses</h2></div></div>{activeDiagnoses.length > 0 && <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Code</th><th>Description</th><th>Primary</th></tr></thead><tbody>{activeDiagnoses.map((diagnosis) => <tr key={diagnosis.id}><td><strong>{String(diagnosis.diagnosis_code)}</strong></td><td>{String(diagnosis.diagnosis_description ?? "—")}</td><td>{diagnosis.is_primary ? "Yes" : "No"}</td></tr>)}</tbody></table></div>}{(!signed || data.claims.length === 0) && <div className="encounter-compact-form">{signed && <p className="thera-table-subtext">Add a billing diagnosis without unlocking or altering the signed clinical note. Verify that the diagnosis is supported by the documented assessment.</p>}<Icd10SearchInput code={diagnosisCode} description={diagnosisDescription} serviceDate={serviceDate} onSelect={(result) => { setDiagnosisCode(result.code); if (result.name) setDiagnosisDescription(result.name); }} /><input className="thera-input" placeholder="Diagnosis description" value={diagnosisDescription} onChange={(event) => setDiagnosisDescription(event.target.value)} /><button type="button" className="thera-action secondary" disabled={saving || !diagnosisCode.trim()} onClick={() => void addDiagnosis()}>+ Add Diagnosis</button></div>}</section>
        <section className="thera-card" id="encounter-coding-service">
          <div className="thera-card-header split"><div><div className="thera-eyebrow">CLAIM CORRECTIONS</div><h2>Coding & Service</h2><p>Correct rejected or held claim fields in the revenue-cycle workqueue; signed clinical notes stay locked.</p></div><div className="thera-filter-row">{data.chargeLines.some((charge) => charge.charge_status === "blocked") && <button type="button" className="thera-action secondary" disabled={saving} onClick={() => void withSave(async () => { const result = await createChargeFromEncounter(encounterId); if (!result.ok) throw new Error(result.details?.join(" ") || result.message); }, "Existing charges reconciled against the corrected service lines.")}>Reconcile Charges</button>}<button type="button" className="thera-action secondary" disabled={saving} onClick={() => void withSave(async () => { const result = await routeEncounterToBilling(encounterId); if (!result.ok && !result.blocked) throw new Error(result.message); }, "Billing readiness rechecked against current encounter data.", true)}>Recheck Billing</button><Link href="/rejections" className="thera-action secondary">Open Rejections →</Link></div></div>
          <div className="encounter-claim-actions" role="group" aria-label="Correct and release claims">
            {data.claims.length ? data.claims.map((claim) => { const status = String(claim.claim_status ?? "draft"); const rejected = ["rejected", "validation_failed"].includes(status); const ready = ["draft", "ready_for_validation", "ready_for_batch"].includes(status); const href = rejected ? `/rejections?claim=${encodeURIComponent(String(claim.id))}` : ready ? `/billing/charges?tab=unbatched&claim=${encodeURIComponent(String(claim.id))}` : `/claims?claim=${encodeURIComponent(String(claim.id))}`; return <div key={String(claim.id)} className="encounter-linked-claim"><div><strong>{String(claim.patient_control_number ?? "Claim")}</strong><StatusBadge value={status} /></div><Link className="thera-action secondary" href={href}>{rejected ? "Correct Held Claim" : ready ? "Validate / Batch Claim" : "Work Claim"} →</Link></div>; }) : <div className="encounter-linked-claim"><span>No claim has been generated for this encounter.</span><Link className="thera-action secondary" href={`/billing/charges?tab=blocked&encounter=${encodeURIComponent(encounterId)}`}>Review Billing Issues →</Link></div>}
            <p>Corrections are made to the actual claim in revenue-cycle workqueues, never by changing a signed clinical note.</p>
          </div>
          <div className="encounter-coding-summary"><Field label="Scheduled Time" value={duration ? `${duration} minutes` : "Not available"} /><Field label="Visit Location" value={String(encounter.location_type ?? "—").replaceAll("_", " ")} /><Field label="Current POS" value={placeOfService || "—"} /><Field label="Payer" value={String(data.payer?.name ?? "—")} /></div>
          <div className="encounter-saved-services"><div className="thera-card-header"><div><h3>Recorded service lines ({data.serviceLines.length})</h3><p>Unclaimed source lines—including ready-for-claim charges—can be edited or voided after signing. Submitted claims and posted balances remain locked.</p></div></div>{data.serviceLines.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>CPT / HCPCS</th><th>Modifier</th><th>Units</th><th>POS</th><th>Charge</th>{canEditUnbilledServices && <th>Actions</th>}</tr></thead><tbody>{data.serviceLines.map((line) => <tr key={String(line.id)}><td><strong>{String(line.cpt_hcpcs_code ?? "—")}</strong></td><td>{String(line.modifier1 ?? "—")}</td><td>{String(line.units ?? 1)}</td><td>{String(line.place_of_service_code ?? "—")}</td><td>{Number(line.charge_amount_cents ?? 0) > 0 ? money(Number(line.charge_amount_cents)) : <><span className="encounter-service-warning">Missing charge</span>{canEditUnbilledServices && !billedLineIds.has(String(line.id)) && <button type="button" className="thera-link" disabled={saving} onClick={() => { editServiceLine(line); window.setTimeout(() => document.getElementById("encounter-charge-amount")?.focus(), 0); }}>Fix amount →</button>}</>}</td>{canEditUnbilledServices && <td><div className="thera-filter-row"><button type="button" className="thera-action secondary" disabled={saving || billedLineIds.has(String(line.id))} onClick={() => editServiceLine(line)}>Edit</button><button type="button" className="thera-action secondary" disabled={saving || !removableLineIds.has(String(line.id))} onClick={() => void removeServiceLine(String(line.id))}>Remove</button>{billedLineIds.has(String(line.id)) && <Link className="thera-link" href="/billing/charges">Open charge →</Link>}</div></td>}</tr>)}</tbody></table></div> : <div className="thera-empty">No service lines recorded for this visit.</div>}</div>
          {canEditUnbilledServices && <div className="encounter-service-editor" id="encounter-service-editor"><div className="thera-card-header split"><div><h3>{editingServiceLineId ? "Edit service line" : "Add service line"}</h3><p>Enter the code, units, place of service and a charge greater than $0.</p></div>{editingServiceLineId && <button className="thera-action secondary" type="button" disabled={saving} onClick={resetServiceEditor}>Cancel edit</button>}</div><div className="encounter-service-form"><label>Procedure code <ProcedureCodeSearchInput code={serviceCode} serviceDate={serviceDate} onSelect={(result) => setServiceCode(result.code)} onFeeResolved={(fee, replaceExisting) => { if (fee) setChargeDollars((fee.rateCents / 100).toFixed(2)); else if (replaceExisting) setChargeDollars(""); }} /></label><label>Modifier (optional) <input className="thera-input" maxLength={2} placeholder="e.g., 95" value={modifier1} onChange={(event) => setModifier1(event.target.value.toUpperCase())} /></label><label>Units <input aria-label="Service units" className="thera-input" type="number" min={1} step={1} value={units} onChange={(event) => setUnits(Number(event.target.value))} /></label><label>Place of service <PlaceOfServiceSearchInput code={placeOfService} onSelect={(result) => setPlaceOfService(result.code)} /></label><label>Charge ($) <input id="encounter-charge-amount" aria-label="Service charge" className="thera-input" type="number" step="0.01" min="0.01" placeholder="0.00" value={chargeDollars} onChange={(event) => setChargeDollars(event.target.value)} /></label><div className="encounter-service-submit"><button type="button" className="thera-action" disabled={saving} onClick={() => void addServiceLine()}>{saving ? "Saving…" : editingServiceLineId ? "Save Service Line" : "+ Add Service Line"}</button></div></div>{serviceError && <div className="thera-state error" role="alert" style={{ marginTop: 9 }}>{serviceError}</div>}</div>}
        </section>
      </div>
    </>
  );
}

function ContextButton({ active, label, short, onClick }: { active: boolean; label: string; short: string; onClick: () => void }) {
  return <button type="button" aria-pressed={active} aria-label={label} title={label} className={active ? "encounter-context-tab active" : "encounter-context-tab"} onClick={onClick}><span aria-hidden="true">{short}</span><small>{label}</small></button>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="thera-field-label">{label}</div><div className="thera-field-value">{value}</div></div>;
}
