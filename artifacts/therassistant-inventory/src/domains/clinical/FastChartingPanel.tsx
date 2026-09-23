import { useState } from "react";
import {
  NOTE_SIMILARITY_REVIEW_THRESHOLD,
  formatTimelineForNote,
  type PriorStructuredContext,
  type SmartPhrase,
  type StructuredSelections,
} from "./fast-charting";
import { ForensicSpecialtyPanel } from "./ForensicSpecialtyPanel";
import { PsychedelicSpecialtyPanel } from "./PsychedelicSpecialtyPanel";
import {
  isPsychedelicTemplate,
  psychedelicPhaseForTemplate,
} from "./psychedelic-context";
import {
  CLINICAL_TAG_OPTIONS,
  DOCUMENTATION_TEMPLATES,
  documentationTemplateById,
  type ClinicalTagId,
  type DocumentationTemplate,
} from "./clinical-context";

type Props = {
  signed: boolean;
  phrases: SmartPhrase[];
  selections: StructuredSelections;
  generatedNarrative: string;
  priorContext: PriorStructuredContext | null;
  noteSimilarity: number;
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
  const [timelineTime, setTimelineTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [timelineLabel, setTimelineLabel] = useState("");
  const [timelineDetail, setTimelineDetail] = useState("");

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

  function setTemplate(value: DocumentationTemplate) {
    props.onSelectionsChange({
      ...props.selections,
      templateType: value,
      psychedelicContext: isPsychedelicTemplate(value)
        ? { ...props.selections.psychedelicContext, phase: psychedelicPhaseForTemplate(value) }
        : props.selections.psychedelicContext,
    });
  }

  function toggleClinicalTag(value: ClinicalTagId) {
    const has = props.selections.clinicalTags.includes(value);
    props.onSelectionsChange({
      ...props.selections,
      clinicalTags: has
        ? props.selections.clinicalTags.filter((item) => item !== value)
        : [...props.selections.clinicalTags, value],
    });
  }

  function addTimelineEvent() {
    const label = timelineLabel.trim();
    if (!label || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timelineTime)) return;
    props.onSelectionsChange({
      ...props.selections,
      timelineEvents: [
        ...props.selections.timelineEvents,
        { time: timelineTime, label, detail: timelineDetail.trim() },
      ],
    });
    setTimelineLabel("");
    setTimelineDetail("");
    setTimelineTime(new Date().toTimeString().slice(0, 5));
  }

  function removeTimelineEvent(index: number) {
    props.onSelectionsChange({
      ...props.selections,
      timelineEvents: props.selections.timelineEvents.filter((_, itemIndex) => itemIndex !== index),
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

  const template = documentationTemplateById(props.selections.templateType);

  return <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
    <div className="thera-card" style={{ padding: 12 }}>
      <div className="thera-filter-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <strong>Documentation Context</strong>
          <div className="thera-table-subtext">Template context changes the prompts shown here. It does not change billing, diagnosis, or signing rules.</div>
        </div>
      </div>
      <div className="thera-form-grid" style={{ marginTop: 10 }}>
        <label>
          Documentation Template
          <select
            className="thera-input"
            disabled={props.signed}
            value={props.selections.templateType}
            onChange={(event) => setTemplate(event.target.value as DocumentationTemplate)}
          >
            {DOCUMENTATION_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <div>
          <div className="thera-field-label">Template Guidance</div>
          <div className="thera-field-value">{template.description}</div>
          <div className="thera-table-subtext" style={{ marginTop: 4 }}>{template.prompts.join(" · ")}</div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="thera-field-label">Clinical Tags</div>
        <div className="thera-table-subtext">Clinician-selected chart context only. Tags do not automatically assign diagnoses or billing codes.</div>
        <div className="thera-filter-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
          {CLINICAL_TAG_OPTIONS.map((tag) => <ChoiceButton
            key={tag.id}
            active={props.selections.clinicalTags.includes(tag.id)}
            disabled={props.signed}
            label={tag.label}
            onClick={() => toggleClinicalTag(tag.id)}
          />)}
        </div>
      </div>
    </div>

    {props.selections.templateType === "forensic" && (
      <ForensicSpecialtyPanel
        signed={props.signed}
        value={props.selections.forensicContext}
        onChange={(forensicContext) => props.onSelectionsChange({ ...props.selections, forensicContext })}
        onInsertIntoNote={props.onInsertPhrase}
      />
    )}

    {isPsychedelicTemplate(props.selections.templateType) && (
      <PsychedelicSpecialtyPanel
        signed={props.signed}
        templateType={props.selections.templateType}
        value={props.selections.psychedelicContext}
        onChange={(psychedelicContext) => props.onSelectionsChange({ ...props.selections, psychedelicContext })}
        onInsertIntoNote={props.onInsertPhrase}
      />
    )}

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
        <div>
          <strong>Session Timeline</strong>
          <div className="thera-table-subtext">Timestamp important events during any complex or extended encounter. Insert the timeline into the note before signing so it becomes part of the locked clinical record.</div>
        </div>
      </div>
      {!props.signed && props.selections.templateType === "kap_medicine_session" && <div className="thera-filter-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
        {["Administration context", "Monitoring observation", "Somatic / emotional response", "Grounding / return"].map((preset) => (
          <button type="button" className="thera-action secondary" key={preset} onClick={() => setTimelineLabel(preset)}>{preset}</button>
        ))}
      </div>}
      {!props.signed && <div className="thera-form-grid" style={{ marginTop: 10 }}>
        <label>Time<input className="thera-input" type="time" value={timelineTime} onChange={(event) => setTimelineTime(event.target.value)} /></label>
        <label>Event<input className="thera-input" value={timelineLabel} onChange={(event) => setTimelineLabel(event.target.value)} placeholder="e.g., Grounding intervention" /></label>
        <label style={{ gridColumn: "1 / -1" }}>Detail<input className="thera-input" value={timelineDetail} onChange={(event) => setTimelineDetail(event.target.value)} placeholder="Optional patient response or clinical context" /></label>
        <button type="button" className="thera-action secondary" disabled={!timelineLabel.trim()} onClick={addTimelineEvent}>+ Add Timeline Event</button>
      </div>}
      {props.selections.timelineEvents.length > 0 ? <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {props.selections.timelineEvents.map((event, index) => <div className="thera-alert" key={`${event.time}-${index}`}>
          <strong>{event.time} · {event.label}</strong>
          {event.detail && <div style={{ marginTop: 4 }}>{event.detail}</div>}
          {!props.signed && <button type="button" className="thera-action secondary" style={{ marginTop: 6 }} onClick={() => removeTimelineEvent(index)}>Remove</button>}
        </div>)}
        {!props.signed && <button type="button" className="thera-action secondary" onClick={() => props.onInsertPhrase("\n" + formatTimelineForNote(props.selections.timelineEvents) + "\n")}>Insert Timeline into Note</button>}
      </div> : <div className="thera-table-subtext" style={{ marginTop: 8 }}>No timeline events recorded.</div>}
    </div>

    {props.priorContext && props.noteSimilarity >= NOTE_SIMILARITY_REVIEW_THRESHOLD && <div className="thera-card" style={{ padding: 12 }}>
      <div className="thera-alert">
        <strong>Prior-note similarity review</strong>
        <div style={{ marginTop: 4 }}>
          This draft is {Math.round(props.noteSimilarity * 100)}% similar to the prior signed note{props.priorContext.serviceDate ? ` from ${props.priorContext.serviceDate}` : ""}. Review patient-specific changes before signing. This is an advisory review and does not block signature.
        </div>
        {!props.signed && <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <input
            type="checkbox"
            checked={props.selections.similarityReviewAcknowledged}
            onChange={(event) => props.onSelectionsChange({ ...props.selections, similarityReviewAcknowledged: event.target.checked })}
          />
          I reviewed this draft for patient-specific accuracy.
        </label>}
      </div>
    </div>}

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
