import { useState } from "react";

import {
  FORENSIC_REFERENCE_LINKS,
  formatForensicContextForNote,
  type ForensicAssessmentReference,
  type ForensicContext,
  type ForensicFramework,
  type ForensicProgressRating,
} from "./forensic-context";

type Props = {
  signed: boolean;
  value: ForensicContext;
  onChange: (next: ForensicContext) => void;
  onInsertIntoNote: (text: string) => void;
};

const progressOptions: Array<[ForensicProgressRating, string]> = [
  ["", "Not selected"],
  ["improving", "Improving"],
  ["stable", "Stable"],
  ["needs_attention", "Needs attention"],
  ["not_assessed", "Not assessed this session"],
];

export function ForensicSpecialtyPanel(props: Props) {
  const [assessmentName, setAssessmentName] = useState("");
  const [assessmentDate, setAssessmentDate] = useState("");
  const [assessmentSummary, setAssessmentSummary] = useState("");

  function patch(values: Partial<ForensicContext>) {
    props.onChange({ ...props.value, ...values });
  }

  function setProgress(
    key: keyof ForensicContext["progress"],
    value: ForensicProgressRating,
  ) {
    props.onChange({
      ...props.value,
      progress: { ...props.value.progress, [key]: value },
    });
  }

  function addAssessmentReference() {
    const name = assessmentName.trim();
    if (!name) return;
    const next: ForensicAssessmentReference = {
      name,
      date: assessmentDate,
      resultSummary: assessmentSummary.trim(),
    };
    patch({ assessmentReferences: [...props.value.assessmentReferences, next] });
    setAssessmentName("");
    setAssessmentDate("");
    setAssessmentSummary("");
  }

  function removeAssessment(index: number) {
    patch({
      assessmentReferences: props.value.assessmentReferences.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    });
  }

  const reference =
    props.value.framework === "dvomb_adult"
      ? FORENSIC_REFERENCE_LINKS.dvomb_adult
      : props.value.framework === "somb_adult"
        ? FORENSIC_REFERENCE_LINKS.somb_adult
        : null;

  return (
    <div className="thera-card" style={{ padding: 12 }}>
      <div className="thera-filter-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <strong>Forensic / Justice-Involved Specialty Context</strong>
          <div className="thera-table-subtext">
            Provider-entered treatment context only. This panel does not calculate risk,
            predict behavior, reproduce proprietary assessment items, or determine SOMB/DVOMB compliance.
          </div>
        </div>
      </div>

      <div className="thera-form-grid" style={{ marginTop: 10 }}>
        <label>
          Specialty framework
          <select
            className="thera-input"
            disabled={props.signed}
            value={props.value.framework}
            onChange={(event) => patch({ framework: event.target.value as ForensicFramework })}
          >
            <option value="none">Select framework</option>
            <option value="justice_involved">General justice-involved treatment</option>
            <option value="dvomb_adult">Colorado DVOMB adult context</option>
            <option value="somb_adult">Colorado SOMB adult context</option>
            <option value="other_specialty">Other forensic specialty</option>
          </select>
        </label>
        <label>
          Referral source
          <input
            className="thera-input"
            disabled={props.signed}
            value={props.value.referralSource}
            onChange={(event) => patch({ referralSource: event.target.value })}
            placeholder="Probation, parole, court, self-referral, etc."
          />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Multidisciplinary / coordination context
          <input
            className="thera-input"
            disabled={props.signed}
            value={props.value.coordinationContext}
            onChange={(event) => patch({ coordinationContext: event.target.value })}
            placeholder="Provider-entered coordination context; avoid unnecessary third-party detail."
          />
        </label>
        <label>
          Standards last reviewed
          <input
            className="thera-input"
            type="date"
            disabled={props.signed}
            value={props.value.standardsReviewedOn}
            onChange={(event) => patch({ standardsReviewedOn: event.target.value })}
          />
        </label>
        <div>
          <div className="thera-field-label">Standards reference</div>
          {reference ? (
            <a className="thera-link" href={reference.url} target="_blank" rel="noreferrer">
              {reference.label}
            </a>
          ) : (
            <div className="thera-table-subtext">Select a Colorado specialty framework to show the official reference.</div>
          )}
          <div className="thera-table-subtext" style={{ marginTop: 4 }}>
            Standards change over time. Review the current official source before relying on a requirement.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="thera-field-label">Provider-observed treatment progress</div>
        <div className="thera-form-grid" style={{ marginTop: 6 }}>
          <ProgressSelect signed={props.signed} label="Attendance / participation" value={props.value.progress.attendance} onChange={(value) => setProgress("attendance", value)} />
          <ProgressSelect signed={props.signed} label="Treatment engagement" value={props.value.progress.engagement} onChange={(value) => setProgress("engagement", value)} />
          <ProgressSelect signed={props.signed} label="Accountability / responsibility work" value={props.value.progress.accountability} onChange={(value) => setProgress("accountability", value)} />
          <ProgressSelect signed={props.signed} label="Responsivity / barriers" value={props.value.progress.responsivity} onChange={(value) => setProgress("responsivity", value)} />
          <ProgressSelect signed={props.signed} label="Skill application" value={props.value.progress.skillApplication} onChange={(value) => setProgress("skillApplication", value)} />
        </div>
      </div>

      <div className="thera-form-grid" style={{ marginTop: 12 }}>
        <label style={{ gridColumn: "1 / -1" }}>
          Dynamic treatment needs
          <textarea
            className="thera-input"
            disabled={props.signed}
            value={props.value.dynamicTreatmentNeeds}
            onChange={(event) => patch({ dynamicTreatmentNeeds: event.target.value })}
            placeholder="Clinician-defined treatment needs or barriers. Do not convert this field into an automated risk score."
          />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Protective factors / strengths
          <textarea
            className="thera-input"
            disabled={props.signed}
            value={props.value.protectiveFactors}
            onChange={(event) => patch({ protectiveFactors: event.target.value })}
          />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Provider narrative
          <textarea
            className="thera-input"
            disabled={props.signed}
            value={props.value.providerNarrative}
            onChange={(event) => patch({ providerNarrative: event.target.value })}
            placeholder="Patient-specific treatment progress and clinically relevant observations."
          />
        </label>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="thera-field-label">Assessment references</div>
        <div className="thera-table-subtext">
          Record the assessment name/date/result reference only. Do not reproduce licensed instrument items or scoring manuals.
        </div>
        {!props.signed && <div className="thera-form-grid" style={{ marginTop: 8 }}>
          <label>Assessment / instrument<input className="thera-input" value={assessmentName} onChange={(event) => setAssessmentName(event.target.value)} /></label>
          <label>Date<input className="thera-input" type="date" value={assessmentDate} onChange={(event) => setAssessmentDate(event.target.value)} /></label>
          <label style={{ gridColumn: "1 / -1" }}>Result / chart reference<input className="thera-input" value={assessmentSummary} onChange={(event) => setAssessmentSummary(event.target.value)} placeholder="Provider-entered result summary or where the full assessment is filed." /></label>
          <button type="button" className="thera-action secondary" disabled={!assessmentName.trim()} onClick={addAssessmentReference}>+ Add Assessment Reference</button>
        </div>}
        {props.value.assessmentReferences.length > 0 && <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {props.value.assessmentReferences.map((item, index) => (
            <div className="thera-alert" key={`${item.name}-${item.date}-${index}`}>
              <strong>{item.name}{item.date ? ` · ${item.date}` : ""}</strong>
              {item.resultSummary && <div style={{ marginTop: 4 }}>{item.resultSummary}</div>}
              {!props.signed && <button type="button" className="thera-action secondary" style={{ marginTop: 6 }} onClick={() => removeAssessment(index)}>Remove</button>}
            </div>
          ))}
        </div>}
      </div>

      {!props.signed && props.value.framework !== "none" && (
        <button
          type="button"
          className="thera-action secondary"
          style={{ marginTop: 12 }}
          onClick={() => props.onInsertIntoNote("\n" + formatForensicContextForNote(props.value) + "\n")}
        >
          Insert Specialty Context into Note
        </button>
      )}
    </div>
  );
}

function ProgressSelect({
  signed,
  label,
  value,
  onChange,
}: {
  signed: boolean;
  label: string;
  value: ForensicProgressRating;
  onChange: (value: ForensicProgressRating) => void;
}) {
  return (
    <label>
      {label}
      <select className="thera-input" disabled={signed} value={value} onChange={(event) => onChange(event.target.value as ForensicProgressRating)}>
        {progressOptions.map(([option, text]) => <option key={option || "empty"} value={option}>{text}</option>)}
      </select>
    </label>
  );
}
