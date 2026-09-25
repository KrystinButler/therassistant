import { useEffect, useState } from "react";
import "./fast-charting-panel.css";
import {
  NOTE_SIMILARITY_REVIEW_THRESHOLD,
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
  noteType: string;
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

function ChoiceButton({ active, label, onClick, disabled }: { active: boolean; label: string; onClick: () => void; disabled: boolean }) {
  return <button type="button" className="fast-chart-choice" aria-pressed={active} disabled={disabled} onClick={onClick}>{label}</button>;
}

export function FastChartingPanel(props: Props) {
  const [showPhraseForm, setShowPhraseForm] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [shortcut, setShortcut] = useState("");
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [scope, setScope] = useState<"user" | "practice">("user");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const hasSpecialty = !["standard_therapy", "intake"].includes(props.selections.templateType);
  const specialty = hasSpecialty ? documentationTemplateById(props.selections.templateType) : null;
  const baseTemplate: DocumentationTemplate = ["assessment", "intake"].includes(props.noteType) ? "intake" : "standard_therapy";

  useEffect(() => {
    if (hasSpecialty || props.selections.clinicalTags.length > 0) setAdvancedOpen(true);
  }, [hasSpecialty, props.selections.clinicalTags.length]);

  return <div className="fast-chart-tools">
    <section className="fast-chart-advanced" aria-labelledby="fast-chart-advanced-heading">
      <button type="button" className="fast-chart-advanced-toggle"
        aria-expanded={advancedOpen} aria-controls="fast-chart-advanced-content"
        onClick={() => setAdvancedOpen((open) => !open)}>
        <span>
          <strong id="fast-chart-advanced-heading">Specialty Modules & Clinical Tags</strong>
          <small>Optional. Your Note Type above controls the main note layout.</small>
        </span>
        <span className="fast-chart-advanced-state">
          {specialty ? specialty.label : props.selections.clinicalTags.length
            ? `${props.selections.clinicalTags.length} tag${props.selections.clinicalTags.length === 1 ? "" : "s"} selected`
            : "None selected"}
          <span aria-hidden="true">{advancedOpen ? "▴" : "▾"}</span>
        </span>
      </button>
      {advancedOpen && <div id="fast-chart-advanced-content" className="fast-chart-advanced-content">
        <label className="fast-chart-specialty-field">
          Specialty module
          <select className="thera-input" disabled={props.signed}
            value={hasSpecialty ? props.selections.templateType : baseTemplate}
            onChange={(event) => setTemplate(event.target.value as DocumentationTemplate)}>
            <option value={baseTemplate}>None — use Note Type above</option>
            {DOCUMENTATION_TEMPLATES.filter((item) => item.id !== "standard_therapy" && item.id !== "intake")
              .map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <small>Choose a specialty only when this encounter requires additional fields. Billing codes are managed separately.</small>
        </label>
        <fieldset className="fast-chart-tags">
          <legend>Clinical tags <span>(optional)</span></legend>
          <p>Add clinician-assessed context. Tags never automatically assign a diagnosis or procedure code.</p>
          <div className="fast-chart-choice-list" role="group" aria-label="Clinical tags">
            {CLINICAL_TAG_OPTIONS.map((tag) => <ChoiceButton
              key={tag.id}
              active={props.selections.clinicalTags.includes(tag.id)}
              disabled={props.signed}
              label={tag.label}
              onClick={() => toggleClinicalTag(tag.id)}
            />)}
          </div>
        </fieldset>
        {props.priorContext && !props.signed && <button type="button" className="thera-action secondary" onClick={props.onCarryForward}>Carry Forward Clinical Context</button>}
      </div>}
    </section>

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

  </div>;
}
