import { useState } from "react";
import { readNoteSection, updateNoteSection } from "./note-section-editing";
import { readSubmittedVisitQuestion as question } from "../encounters/clinical-source-context";
import { phqImportNarrative, gadImportNarrative, cssrsImportNarrative } from "./clinical-note-imports";
import { ClinicalTelemetryChart } from "./ClinicalTelemetryChart";
import { evaluateCrossSystemEngine } from "./cross-system-engine";
import "./cross-system-testability.css";

type Row = Record<string, any>;

type PreVisit = {
  focus: string;
  mood: string;
  changes: string[];
  treatmentGoal: string;
  additionalContext: string;
  safetyText: string;
  hasSubmittedPreVisit: boolean;
};

type Props = {
  mode?: "editor" | "context";
  client: Row | null;
  policy: Row | null;
  payer: Row | null;
  plan: Row | null;
  currentCheckin: Row | null;
  preVisit: PreVisit;
  journalEntry: Row | null;
  activeGoalText: string;
  goalAddressed: string;
  outcomeMeasures: Row[];
  safetyScreenings: Row[];
  diagnoses: Row[];
  serviceLines: Row[];
  serviceDate: string;
  signed: boolean;
  noteText: string;
  onNoteTextChange: (value: string) => void;
  privateNoteText: string;
  privateSaving: boolean;
  onPrivateNoteChange: (value: string) => void;
  onSavePrivateNote: () => void;
  onInsertNarrative: (value: string) => void;
};

function value(row: Row | null | undefined, keys: string[], fallback = "—") {
  for (const key of keys) {
    const found = row?.[key];
    if (found !== undefined && found !== null && String(found).trim()) return String(found).trim();
  }
  return fallback;
}

function latestTwo(rows: Row[], instrument: string) {
  return rows.filter((row) => String(row.instrument) === instrument)
    .sort((a, b) => String(b.assessed_on ?? b.created_at ?? "").localeCompare(String(a.assessed_on ?? a.created_at ?? "")))
    .slice(0, 2);
}

function signalScore(row: Row | undefined) {
  if (!row) return null;
  const raw = row.score ?? row.score_text;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : String(raw);
}

function signalDate(row: Row | undefined) {
  const date = String(row?.assessed_on ?? row?.created_at ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function signalTrend(rows: Row[]) {
  const current = Number(rows[0]?.score ?? rows[0]?.score_text);
  const prior = Number(rows[1]?.score ?? rows[1]?.score_text);
  if (!Number.isFinite(current)) return "No result";
  if (!Number.isFinite(prior)) return "No prior result";
  if (current > prior) return `↑ from ${prior}`;
  if (current < prior) return `↓ from ${prior}`;
  return `→ unchanged from ${prior}`;
}

function ScreeningCard({ title, importLabel, narrative, rows }: { title: string; importLabel: string; narrative: string; rows: Row[] }) {
  const current = rows[0];
  const prior = rows[1];
  const currentScore = current ? value(current, ["score", "score_text"], "—") : "—";
  const priorScore = prior ? value(prior, ["score", "score_text"], "—") : "—";
  return <div className="clinical-screening-card">
    <div><span>{importLabel}</span><strong>{title}</strong></div>
    <dl><div><dt>Current</dt><dd>{currentScore}</dd></div><div><dt>Last visit</dt><dd>{priorScore}</dd></div></dl>
    <p>{narrative || "No screening result recorded."}</p>
  </div>;
}

function InsertButton({ children, value, disabled, onInsert }: { children: React.ReactNode; value: string; disabled: boolean; onInsert: (value: string) => void }) {
  return <button type="button" className="thera-action secondary clinical-insert" disabled={disabled || !value.trim()} onClick={() => onInsert(value)}>{children}</button>;
}

function SignalCard({ label, rows, suffix = "" }: { label: string; rows: Row[]; suffix?: string }) {
  const score = signalScore(rows[0]);
  return <div className="clinical-signal-card">
    <span>{label}</span>
    <strong>{score ?? "No result"}{score !== null && suffix ? suffix : ""}</strong>
    <small>{signalDate(rows[0]) || "No date"}</small>
    <em>{signalTrend(rows)}</em>
  </div>;
}

export function ClinicalNoteWorkspace(props: Props) {
  const [showCrossSystemReview, setShowCrossSystemReview] = useState(false);
  const phqRows = latestTwo(props.outcomeMeasures, "PHQ-9");
  const gadRows = latestTwo(props.outcomeMeasures, "GAD-7");
  const prsdsRows = latestTwo(props.outcomeMeasures, "PRSDS");
  const cssrsRows = latestTwo(props.safetyScreenings, "C-SSRS");
  const phq = phqImportNarrative(props.outcomeMeasures);
  const gad = gadImportNarrative(props.outcomeMeasures);
  const risk = cssrsImportNarrative(props.safetyScreenings);
  const activeDiagnoses = props.diagnoses.filter((row) => row.present_on_claim !== false);
  const journalText = value(props.journalEntry, ["entry_text"], "");
  const goalWork = question(props.currentCheckin, ["goal_to_work_on", "treatment_goal", "focus_goal"]);
  const goalUpdate = question(props.currentCheckin, ["goal_to_update", "goal_update"]);
  const goalAdd = question(props.currentCheckin, ["goal_to_add", "new_goal"]);
  const cc = props.preVisit.focus ? `Client completed the pre-visit portal intake check-in. Current presenting concerns are documented as: ${props.preVisit.focus}.` : "";
  const hpi = journalText ? `Review of client's submitted digital portal journal entries reflects the following recent updates, symptoms, and clinical stressors: ${journalText}` : "";
  const crossSystemEvaluation = evaluateCrossSystemEngine({
    narrativeText: [
      props.preVisit.focus,
      props.preVisit.mood,
      props.preVisit.changes.join(" "),
      props.preVisit.additionalContext,
      props.preVisit.safetyText,
      journalText,
      goalWork,
      goalUpdate,
      goalAdd,
    ].filter(Boolean).join("\n"),
    diagnosisCodes: activeDiagnoses.map((row) => String(row.diagnosis_code ?? "")),
  });
  const suggestedDiagnosisSequence = crossSystemEvaluation.suggestedDiagnosisSequence ?? [];
  const cssrsCurrent = cssrsRows[0];
  const cssrsDisplay = cssrsCurrent ? value(cssrsCurrent, ["risk_level", "score_text", "score"], "No result") : "No result";

  const contextHeader = <>
    <div className="clinical-note-demographics">
      <div><span>Patient</span><strong>{[props.client?.first_name, props.client?.last_name].filter(Boolean).join(" ") || "—"}</strong></div>
      <div><span>DOB</span><strong>{value(props.client, ["date_of_birth", "dob"])}</strong></div>
      <div><span>Phone</span><strong>{value(props.client, ["phone", "mobile_phone"])}</strong></div>
      <div><span>Email</span><strong>{value(props.client, ["email"])}</strong></div>
      <div className="clinical-note-coverage"><span>Primary coverage</span><strong>{value(props.payer, ["name"])}</strong><small>{value(props.plan, ["plan_name", "name"], "")}</small></div>
    </div>

    <section className="clinical-signals-strip" aria-label="Clinical Signals">
      <div className="clinical-signals-heading"><div><span className="thera-eyebrow">CLINICAL SIGNALS</span><h3>Clinical Signals</h3></div><small>Current score, prior direction, and safety status</small></div>
      <div className="clinical-signals-grid">
        <SignalCard label="PHQ-9" rows={phqRows} />
        <SignalCard label="GAD-7" rows={gadRows} />
        <SignalCard label="PRSDS" rows={prsdsRows} suffix="/10" />
        <div className="clinical-signal-card clinical-signal-risk"><span>C-SSRS</span><strong>{cssrsDisplay}</strong><small>{signalDate(cssrsCurrent) || "No date"}</small><em>{cssrsCurrent ? "Latest recorded safety screening" : "No result"}</em></div>
      </div>
    </section>

    <section className={`cross-system-monitor ${crossSystemEvaluation.matchedRules.length ? "active" : "idle"}`} aria-label="Cross-System Monitoring">
      <div className="cross-system-monitor-heading">
        <div><span className="thera-eyebrow">CROSS-SYSTEM MONITORING</span><h3>Cross-System Monitoring: {crossSystemEvaluation.matchedRules.length ? "Active" : "No current match"}</h3></div>
        {crossSystemEvaluation.matchedRules.length > 0 && <button type="button" className="thera-action secondary" onClick={() => setShowCrossSystemReview((current) => !current)}>{showCrossSystemReview ? "Hide Recommendation" : "Review Recommendation"}</button>}
      </div>
      {crossSystemEvaluation.emergencyAlerts.length > 0 && <div className="cross-system-persistent-safety" role="status"><strong>Safety trigger detected</strong><span>The disruptive safety dialog is handled at the encounter level; this indicator stays visible so the trigger remains apparent after the dialog is dismissed.</span></div>}
      {crossSystemEvaluation.matchedRules.length ? <div className="cross-system-rule-chips">{crossSystemEvaluation.matchedRules.map((rule) => <div key={rule.id} className="cross-system-rule-chip"><strong>{rule.id} · {rule.category}</strong><span>{rule.dotPhrase}</span><small>{rule.matchedKeywords.length ? `Matched: ${rule.matchedKeywords.join(", ")}` : "Matched from active diagnosis or safety trigger"}</small></div>)}</div> : <p>No mapped somatic/SUD rule is currently triggered by the loaded patient check-in, journal context, or active diagnoses.</p>}
      {showCrossSystemReview && <div className="cross-system-inline-review">
        <div><h4>Current diagnosis sequence</h4>{activeDiagnoses.length ? activeDiagnoses.map((row, index) => <div className="clinical-code-row" key={String(row.id)}><strong>{index + 1}. {String(row.diagnosis_code ?? "—")}</strong><span>{String(row.diagnosis_description ?? "")}</span></div>) : <p>No active diagnosis sequence recorded.</p>}</div>
        <div><h4>Recommended sequence</h4>{suggestedDiagnosisSequence.length ? suggestedDiagnosisSequence.map((item, index) => <div className="clinical-code-row recommended" key={`${item.code}-${index}`}><strong>{index + 1}. {item.code}</strong><span>{item.description}</span></div>) : <p>No cross-system diagnosis sequence is currently recommended.</p>}</div>
        <p className="cross-system-inline-note">This panel is read-only decision support. The encounter-level Coding Safety Review still requires the clinician to explicitly apply or reject a recommendation.</p>
      </div>}
    </section>

    <div className="clinical-note-top-grid">
      <article className="thera-card clinical-source-panel"><div className="thera-eyebrow">PRESENTING PROBLEM</div><h3>Check-In Answers</h3><p>{props.preVisit.focus || "No presenting problem submitted."}</p><h3>Journal Entries</h3><p>{journalText || "No journal entry shared with the provider."}</p></article>
      <article className="thera-card clinical-source-panel"><div className="thera-eyebrow">SESSION FOCUS</div><Field label="Goal to work on" value={goalWork || props.preVisit.treatmentGoal || props.goalAddressed || props.activeGoalText || "—"} /><Field label="Goal to update" value={goalUpdate || "—"} /><Field label="Goal to add" value={goalAdd || "—"} /></article>
      <article className="thera-card clinical-screening-panel"><div className="thera-eyebrow">STANDARDIZED SCREENINGS</div><ScreeningCard title="PHQ-9" importLabel="IMPORT 3" narrative={phq} rows={phqRows} /><ScreeningCard title="GAD-7" importLabel="IMPORT 4" narrative={gad} rows={gadRows} /><ScreeningCard title="C-SSRS" importLabel="IMPORT 5" narrative={risk} rows={cssrsRows} /></article>
    </div>

    <ClinicalTelemetryChart measures={props.outcomeMeasures} asOfDate={props.serviceDate} />

  </>;
  const editors = <>
    <details className="clinical-note-section" open><summary>Subjective <span>collapsible</span></summary><div className="clinical-note-section-body"><NoteSection heading="Subjective" props={props} /><h4>CC</h4><p>{cc || "No check-in concern available to import."}</p><InsertButton value={cc} disabled={props.signed} onInsert={props.onInsertNarrative}>Insert CC</InsertButton><h4>HPI</h4><p>{hpi || "No shared journal entry available to import."}</p><InsertButton value={hpi} disabled={props.signed} onInsert={props.onInsertNarrative}>Insert HPI</InsertButton></div></details>

    <details className="clinical-note-section" open><summary>Objective <span>collapsible</span></summary><div className="clinical-note-section-body"><NoteSection heading="Objective" props={props} /><div className="clinical-objective-grid"><Objective label="Depression" text={phq} importLabel="IMPORT 3" /><Objective label="Anxiety" text={gad} importLabel="IMPORT 4" /><Objective label="Risk" text={risk} importLabel="IMPORT 5" /></div><div className="clinical-mse-grid"><NoteSection heading="Mental Status Examination" props={props} help="Document observed appearance, behavior, speech, mood and affect, thought process and content, cognition and orientation. No findings are preselected." /></div><div className="clinical-screening-imports"><InsertButton value={phq} disabled={props.signed} onInsert={props.onInsertNarrative}>Insert PHQ-9</InsertButton><InsertButton value={gad} disabled={props.signed} onInsert={props.onInsertNarrative}>Insert GAD-7</InsertButton><InsertButton value={risk} disabled={props.signed} onInsert={props.onInsertNarrative}>Insert C-SSRS</InsertButton></div></div></details>

    <details className="clinical-note-section" open><summary>Assessment <span>collapsible</span></summary><div className="clinical-note-section-body"><NoteSection heading="Assessment" props={props} help="Document your clinical impression and supporting findings." /></div></details>
    <details className="clinical-note-section" open><summary>Plan <span>collapsible</span></summary><div className="clinical-note-section-body"><NoteSection heading="Plan" props={props} /><Field label="Active Treatment Plan Focus" value={props.goalAddressed || props.activeGoalText || "No active goal documented"} />{goalWork && <InsertButton value={`Client identified the primary goal for today's clinical intervention as working directly on: ${goalWork}.`} disabled={props.signed} onInsert={props.onInsertNarrative}>Insert Goal to Work On</InsertButton>}{goalUpdate && <InsertButton value={`Reviewing progress on existing objectives. Client requested an evaluation and updates regarding the following current goal status: ${goalUpdate}.`} disabled={props.signed} onInsert={props.onInsertNarrative}>Insert Goal Update</InsertButton>}{goalAdd && <InsertButton value={`Client requested to introduce a new clinical focal point to the active treatment plan, specifically targeting: ${goalAdd}.`} disabled={props.signed} onInsert={props.onInsertNarrative}>Insert New Goal</InsertButton>}</div></details>

  </>;
  const contextFooter = <>
    <details className="clinical-note-section psychotherapy-private"><summary>Psychotherapy Note <span>private · collapsible</span></summary><div className="clinical-note-section-body"><p>This private psychotherapy note is stored separately from the ordinary clinical note and billing record.</p><textarea className="thera-input clinical-private-note" value={props.privateNoteText} onChange={(event) => props.onPrivateNoteChange(event.target.value)} placeholder="Clinician private psychotherapy note" /><button type="button" className="thera-action secondary" disabled={props.privateSaving} onClick={props.onSavePrivateNote}>{props.privateSaving ? "Saving…" : "Save Private Note"}</button></div></details>

    <details className="clinical-note-section" open><summary>Coding Review <span>collapsible</span></summary><div className="clinical-note-section-body"><p>Code suggestions are never fabricated. Review documented diagnoses and services below; additions and corrections remain in the coding controls after the note.</p><div className="clinical-coding-grid"><div><h4>Current diagnosis sequence</h4>{activeDiagnoses.length ? activeDiagnoses.map((row, index) => <div key={String(row.id)} className="clinical-code-row"><strong>{index + 1}. {String(row.diagnosis_code ?? "—")}</strong><span>{String(row.diagnosis_description ?? "")}</span></div>) : <p>No ICD-10 codes recorded.</p>}</div><div><h4>Recommended sequence</h4>{suggestedDiagnosisSequence.length ? suggestedDiagnosisSequence.map((item, index) => <div key={`${item.code}-${index}`} className="clinical-code-row recommended"><strong>{index + 1}. {item.code}</strong><span>{item.description}</span></div>) : <p>No cross-system diagnosis sequence is currently recommended.</p>}</div><div><h4>CPT / HCPCS</h4>{props.serviceLines.length ? props.serviceLines.map((row) => <div key={String(row.id)} className="clinical-code-row"><strong>{String(row.cpt_hcpcs_code ?? "—")}</strong><span>{row.modifier1 ? `Modifier ${String(row.modifier1)}` : ""}</span></div>) : <p>No CPT / HCPCS lines recorded.</p>}</div></div></div></details>
  </>;
  return <section className={`clinical-note-workspace clinical-note-workspace-${props.mode ?? "all"}`} aria-label={props.mode === "context" ? "Patient clinical context" : "Integrated clinical note workspace"}>
    {props.mode !== "editor" && contextHeader}
    {props.mode !== "context" && editors}
    {props.mode !== "editor" && contextFooter}
  </section>;
}

function Field({ label, value: fieldValue }: { label: string; value: React.ReactNode }) { return <div className="clinical-field"><span>{label}</span><strong>{fieldValue}</strong></div>; }
function Objective({ label, text, importLabel }: { label: string; text: string; importLabel: string }) { return <div className="clinical-objective"><span>{label}</span><strong>{importLabel}</strong><p>{text || "No screening result recorded."}</p></div>; }
function Mse({ label, help }: { label: string; help: string }) { return <div className="clinical-mse"><strong>{label}</strong><span>{help}</span></div>; }

function NoteSection({ heading, props, help }: { heading: string; props: Props; help?: string }) {
  const id = `clinical-section-${heading.toLowerCase().replaceAll(" ", "-")}`;
  return <label className="clinical-section-editor" htmlFor={id}><span>{heading}</span>
    {help && <small id={`${id}-help`}>{help}</small>}
    <textarea id={id} className="thera-input" value={readNoteSection(props.noteText, heading)} disabled={props.signed}
      aria-describedby={help ? `${id}-help` : undefined} placeholder={`Document ${heading.toLowerCase()}…`}
      onChange={(event) => props.onNoteTextChange(updateNoteSection(props.noteText, heading, event.target.value))} />
    <small>Included in the saved clinical note.</small>
  </label>;
}
