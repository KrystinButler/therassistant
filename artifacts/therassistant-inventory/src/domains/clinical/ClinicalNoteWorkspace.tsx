import { phqImportNarrative, gadImportNarrative, cssrsImportNarrative } from "./clinical-note-imports";
import { ClinicalTelemetryChart } from "./ClinicalTelemetryChart";

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

function question(checkin: Row | null, keys: string[]) {
  const q = checkin?.responses?.pre_visit?.visit_questions ?? {};
  return value(q, keys, "");
}

function latestTwo(rows: Row[], instrument: string) {
  return rows.filter((row) => String(row.instrument) === instrument)
    .sort((a, b) => String(b.assessed_on ?? b.created_at ?? "").localeCompare(String(a.assessed_on ?? a.created_at ?? "")))
    .slice(0, 2);
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

export function ClinicalNoteWorkspace(props: Props) {
  const phqRows = latestTwo(props.outcomeMeasures, "PHQ-9");
  const gadRows = latestTwo(props.outcomeMeasures, "GAD-7");
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

  return <section className="clinical-note-workspace" aria-label="Integrated clinical note workspace">
    <div className="clinical-note-demographics">
      <div><span>Patient</span><strong>{[props.client?.first_name, props.client?.last_name].filter(Boolean).join(" ") || "—"}</strong></div>
      <div><span>DOB</span><strong>{value(props.client, ["date_of_birth", "dob"])}</strong></div>
      <div><span>Phone</span><strong>{value(props.client, ["phone", "mobile_phone"])}</strong></div>
      <div><span>Email</span><strong>{value(props.client, ["email"])}</strong></div>
      <div className="clinical-note-coverage"><span>Primary coverage</span><strong>{value(props.payer, ["name"])}</strong><small>{value(props.plan, ["plan_name", "name"], "")}</small></div>
    </div>

    <div className="clinical-note-top-grid">
      <article className="thera-card clinical-source-panel"><div className="thera-eyebrow">PRESENTING PROBLEM</div><h3>Check-In Answers</h3><p>{props.preVisit.focus || "No presenting problem submitted."}</p><h3>Journal Entries</h3><p>{journalText || "No journal entry shared with the provider."}</p></article>
      <article className="thera-card clinical-source-panel"><div className="thera-eyebrow">SESSION FOCUS</div><Field label="Goal to work on" value={goalWork || props.preVisit.treatmentGoal || props.goalAddressed || props.activeGoalText || "—"} /><Field label="Goal to update" value={goalUpdate || "—"} /><Field label="Goal to add" value={goalAdd || "—"} /></article>
      <article className="thera-card clinical-screening-panel"><div className="thera-eyebrow">STANDARDIZED SCREENINGS</div><ScreeningCard title="PHQ-9" importLabel="IMPORT 3" narrative={phq} rows={phqRows} /><ScreeningCard title="GAD-7" importLabel="IMPORT 4" narrative={gad} rows={gadRows} /><ScreeningCard title="C-SSRS" importLabel="IMPORT 5" narrative={risk} rows={cssrsRows} /></article>
    </div>

    <ClinicalTelemetryChart measures={props.outcomeMeasures} asOfDate={props.serviceDate} />

    <details className="clinical-note-section" open><summary>Subjective <span>collapsible</span></summary><div className="clinical-note-section-body"><h4>CC</h4><p>{cc || "No check-in concern available to import."}</p><InsertButton value={cc} disabled={props.signed} onInsert={props.onInsertNarrative}>Insert CC</InsertButton><h4>HPI</h4><p>{hpi || "No shared journal entry available to import."}</p><InsertButton value={hpi} disabled={props.signed} onInsert={props.onInsertNarrative}>Insert HPI</InsertButton></div></details>

    <details className="clinical-note-section" open><summary>Objective <span>collapsible</span></summary><div className="clinical-note-section-body"><div className="clinical-objective-grid"><Objective label="Depression" text={phq} importLabel="IMPORT 3" /><Objective label="Anxiety" text={gad} importLabel="IMPORT 4" /><Objective label="Risk" text={risk} importLabel="IMPORT 5" /></div><div className="clinical-mse-grid"><Mse label="Appearance" help="Grooming, hygiene, dress, and physical posture." /><Mse label="Behavior" help="Eye contact, engagement, psychomotor activity, and cooperation." /><Mse label="Speech" help="Rate, volume, tone, and articulation." /><Mse label="Mood and Affect" help="Apparent emotional state and congruence of affect." /><Mse label="Thought Process & Content" help="Coherence, logical flow, delusions, or obsessions." /><Mse label="Cognition & Orientation" help="Alertness, orientation, and general memory function." /></div></div></details>

    <details className="clinical-note-section" open><summary>Assessment <span>collapsible</span></summary><div className="clinical-note-section-body"><p>Document the clinician's diagnostic impression, supporting findings, differential considerations, and other assessment in the main note editor.</p></div></details>
    <details className="clinical-note-section" open><summary>Plan <span>collapsible</span></summary><div className="clinical-note-section-body"><Field label="Active Treatment Plan Focus" value={props.goalAddressed || props.activeGoalText || "No active goal documented"} />{goalWork && <InsertButton value={`Client identified the primary goal for today's clinical intervention as working directly on: ${goalWork}.`} disabled={props.signed} onInsert={props.onInsertNarrative}>Insert Goal to Work On</InsertButton>}{goalUpdate && <InsertButton value={`Reviewing progress on existing objectives. Client requested an evaluation and updates regarding the following current goal status: ${goalUpdate}.`} disabled={props.signed} onInsert={props.onInsertNarrative}>Insert Goal Update</InsertButton>}{goalAdd && <InsertButton value={`Client requested to introduce a new clinical focal point to the active treatment plan, specifically targeting: ${goalAdd}.`} disabled={props.signed} onInsert={props.onInsertNarrative}>Insert New Goal</InsertButton>}</div></details>

    <details className="clinical-note-section psychotherapy-private"><summary>Psychotherapy Note <span>private · collapsible</span></summary><div className="clinical-note-section-body"><p>This private psychotherapy note is stored separately from the ordinary clinical note and billing record.</p><textarea className="thera-input clinical-private-note" value={props.privateNoteText} onChange={(event) => props.onPrivateNoteChange(event.target.value)} placeholder="Clinician private psychotherapy note" /><button type="button" className="thera-action secondary" disabled={props.privateSaving} onClick={props.onSavePrivateNote}>{props.privateSaving ? "Saving…" : "Save Private Note"}</button></div></details>

    <details className="clinical-note-section" open><summary>Coding Review <span>collapsible</span></summary><div className="clinical-note-section-body"><p>Code suggestions are never fabricated. Review documented diagnoses and services below; additions and corrections remain in the coding controls after the note.</p><div className="clinical-coding-grid"><div><h4>ICD-10</h4>{activeDiagnoses.length ? activeDiagnoses.map((row) => <div key={String(row.id)} className="clinical-code-row"><strong>{String(row.diagnosis_code ?? "—")}</strong><span>{String(row.diagnosis_description ?? "")}</span></div>) : <p>No ICD-10 codes recorded.</p>}</div><div><h4>CPT / HCPCS</h4>{props.serviceLines.length ? props.serviceLines.map((row) => <div key={String(row.id)} className="clinical-code-row"><strong>{String(row.cpt_hcpcs_code ?? "—")}</strong><span>{row.modifier1 ? `Modifier ${String(row.modifier1)}` : ""}</span></div>) : <p>No CPT / HCPCS lines recorded.</p>}</div></div></div></details>
  </section>;
}

function Field({ label, value: fieldValue }: { label: string; value: React.ReactNode }) { return <div className="clinical-field"><span>{label}</span><strong>{fieldValue}</strong></div>; }
function Objective({ label, text, importLabel }: { label: string; text: string; importLabel: string }) { return <div className="clinical-objective"><span>{label}</span><strong>{importLabel}</strong><p>{text || "No screening result recorded."}</p></div>; }
function Mse({ label, help }: { label: string; help: string }) { return <div className="clinical-mse"><strong>{label}</strong><span>{help}</span></div>; }
