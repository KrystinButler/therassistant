import { useState } from "react";
import {
  type PriorStructuredContext,
  type SmartPhrase,
  type StructuredSelections,
} from "./fast-charting";

type Props = {
  signed: boolean;
  phrases: SmartPhrase[];
  selections: StructuredSelections;
  generatedNarrative: string;
  priorContext: PriorStructuredContext | null;
  onSelectionsChange: (next: StructuredSelections) => void;
  onInsertNarrative: () => void;
  onInsertPhrase: (content: string) => void;
  onCarryForward: () => void;
  onCreatePhrase: (input: { shortcut: string; label: string; content: string; scope: "user" | "practice" }) => Promise<void>;
};

const severities = ["none", "mild", "moderate", "severe"] as const;
const interventions = [
  ["cognitive_reframing", "Cognitive Reframing"],
  ["supportive", "Supportive"],
  ["motivational_interviewing", "Motivational Interviewing"],
  ["grounding", "Grounding"],
  ["psychoeducation", "Psychoeducation"],
] as const;

function ChoiceButton({ active, label, onClick, disabled }: { active: boolean; label: string; onClick: () => void; disabled: boolean }) {
  return <button type="button" className={active ? "thera-action" : "thera-action secondary"} disabled={disabled} onClick={onClick}>{label}</button>;
}

export function FastChartingPanel(props: Props) {
  const [showPhraseForm, setShowPhraseForm] = useState(false);
  const [shortcut, setShortcut] = useState("");
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [scope, setScope] = useState<"user" | "practice">("user");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setSeverity(key: "anxiety" | "depression", value: StructuredSelections["anxiety"]) {
    props.onSelectionsChange({ ...props.selections, [key]: props.selections[key] === value ? "" : value });
  }

  function toggleIntervention(value: string) {
    const has = props.selections.interventions.includes(value);
    props.onSelectionsChange({
      ...props.selections,
      interventions: has ? props.selections.interventions.filter((item) => item !== value) : [...props.selections.interventions, value],
    });
  }

  async function savePhrase() {
    setSaving(true);
    setError(null);
    try {
      await props.onCreatePhrase({ shortcut, label, content, scope });
      setShortcut("");
      setLabel("");
      setContent("");
      setShowPhraseForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save SmartPhrase.");
    } finally {
      setSaving(false);
    }
  }

  return <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
    <div className="thera-card" style={{ padding: 12 }}>
      <div className="thera-filter-row" style={{ justifyContent: "space-between" }}>
        <div><strong>SmartPhrases</strong><div className="thera-table-subtext">Type a shortcut then press space, or click one to insert it.</div></div>
        {!props.signed && <button type="button" className="thera-action secondary" onClick={() => setShowPhraseForm((value) => !value)}>{showPhraseForm ? "Close" : "+ SmartPhrase"}</button>}
      </div>
      <div className="thera-filter-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
        {props.phrases.slice(0, 10).map((phrase) => <button type="button" className="thera-action secondary" disabled={props.signed} key={phrase.id} title={phrase.label} onClick={() => props.onInsertPhrase(phrase.content)}>{phrase.shortcut}</button>)}
      </div>
      {showPhraseForm && !props.signed && <div className="thera-form-grid" style={{ marginTop: 10 }}>
        <label>Shortcut<input className="thera-input" value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder=".myphrase" /></label>
        <label>Label<input className="thera-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Display label" /></label>
        <label>Scope<select className="thera-input" value={scope} onChange={(e) => setScope(e.target.value as "user" | "practice")}><option value="user">Only me</option><option value="practice">Practice</option></select></label>
        <label style={{ gridColumn: "1 / -1" }}>Text<textarea className="thera-input" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Text inserted into the note" /></label>
        {error && <div className="thera-state error" style={{ gridColumn: "1 / -1" }}>{error}</div>}
        <button type="button" className="thera-action" disabled={saving || !shortcut.trim() || !content.trim()} onClick={() => void savePhrase()}>{saving ? "Saving..." : "Save SmartPhrase"}</button>
      </div>}
    </div>

    <div className="thera-card" style={{ padding: 12 }}>
      <div className="thera-filter-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div><strong>Click-to-Note</strong><div className="thera-table-subtext">Only selections you make are synthesized into narrative.</div></div>
        {props.priorContext && !props.signed && <button type="button" className="thera-action secondary" onClick={props.onCarryForward}>Carry Forward Structured Context</button>}
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        <div><div className="thera-field-label">Anxiety</div><div className="thera-filter-row" style={{ flexWrap: "wrap" }}>{severities.map((value) => <ChoiceButton key={value} active={props.selections.anxiety === value} disabled={props.signed} label={value} onClick={() => setSeverity("anxiety", value)} />)}</div></div>
        <div><div className="thera-field-label">Depressive Symptoms</div><div className="thera-filter-row" style={{ flexWrap: "wrap" }}>{severities.map((value) => <ChoiceButton key={value} active={props.selections.depression === value} disabled={props.signed} label={value} onClick={() => setSeverity("depression", value)} />)}</div></div>
        <div><div className="thera-field-label">Interventions</div><div className="thera-filter-row" style={{ flexWrap: "wrap" }}>{interventions.map(([value, text]) => <ChoiceButton key={value} active={props.selections.interventions.includes(value)} disabled={props.signed} label={text} onClick={() => toggleIntervention(value)} />)}</div></div>
        <div className="thera-form-grid">
          <label>Patient Response<select className="thera-input" disabled={props.signed} value={props.selections.response} onChange={(e) => props.onSelectionsChange({ ...props.selections, response: e.target.value as StructuredSelections["response"] })}><option value="">Not selected</option><option value="engaged">Engaged</option><option value="receptive">Receptive</option><option value="mixed">Mixed</option><option value="limited">Limited</option></select></label>
          <label>Risk / Safety<select className="thera-input" disabled={props.signed} value={props.selections.risk} onChange={(e) => props.onSelectionsChange({ ...props.selections, risk: e.target.value as StructuredSelections["risk"] })}><option value="">Not selected</option><option value="denies_si_hi">Denies SI/HI</option><option value="passive_si_no_plan">Passive SI, no plan/intent</option><option value="safety_plan_reviewed">Safety plan reviewed</option></select></label>
        </div>
        {props.generatedNarrative ? <div className="thera-alert"><strong>Generated narrative</strong><div style={{ marginTop: 4 }}>{props.generatedNarrative}</div>{!props.signed && <button type="button" className="thera-action secondary" style={{ marginTop: 8 }} onClick={props.onInsertNarrative}>Insert into Note</button>}</div> : <div className="thera-table-subtext">Choose structured findings or interventions to generate a narrative block.</div>}
        {props.priorContext && <div className="thera-table-subtext">Prior structured context available from {props.priorContext.serviceDate || "a previous signed note"}. Carry-forward never copies prior narrative text.</div>}
      </div>
    </div>
  </div>;
}
