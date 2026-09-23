import { useMemo, useState } from "react";

import {
  DEFAULT_EXTERNAL_SUMMARY_OPTIONS,
  buildExternalTreatmentSummary,
  type ExternalSummaryInput,
  type ExternalSummaryOptions,
} from "./external-summary";

type Props = {
  input: ExternalSummaryInput;
};

export function ExternalSummaryPanel({ input }: Props) {
  const [options, setOptions] = useState<ExternalSummaryOptions>(
    DEFAULT_EXTERNAL_SUMMARY_OPTIONS,
  );
  const [message, setMessage] = useState<string | null>(null);
  const summary = useMemo(
    () => buildExternalTreatmentSummary(input, options),
    [input, options],
  );

  function toggle(
    key: Exclude<keyof ExternalSummaryOptions, "audience">,
  ) {
    setOptions((current) => ({ ...current, [key]: !current[key] }));
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary);
      setMessage("Summary copied. Verify authorization and minimum necessary before release.");
    } catch {
      setMessage("Clipboard access is unavailable. Select the summary text and copy it manually.");
    }
  }

  return (
    <section className="thera-card thera-span-2">
      <div className="thera-card-header">
        <div>
          <div className="thera-eyebrow">SIGNED RECORD → EXTERNAL SUMMARY</div>
          <h2>External Treatment Summary</h2>
          <p>
            Generate a minimum-necessary summary from discrete signed-chart data.
            This does not create or alter a clinical note.
          </p>
        </div>
      </div>

      <div className="thera-form-grid">
        <label>
          Audience
          <select
            className="thera-input"
            value={options.audience}
            onChange={(event) =>
              setOptions((current) => ({
                ...current,
                audience: event.target.value as ExternalSummaryOptions["audience"],
              }))
            }
          >
            <option value="court_supervision">Court / Probation / Parole</option>
            <option value="authorized_external">Authorized External Party</option>
          </select>
        </label>
        <div>
          <div className="thera-field-label">Default disclosure scope</div>
          <div className="thera-table-subtext">
            Treatment focus, participation/response, and interventions are included.
            Diagnosis, risk, clinical tags, timeline, and forensic progress are off by default.
          </div>
        </div>
      </div>

      <div className="thera-filter-row" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <Toggle checked={options.includeTreatmentFocus} label="Treatment focus" onChange={() => toggle("includeTreatmentFocus")} />
        <Toggle checked={options.includeParticipation} label="Participation / response" onChange={() => toggle("includeParticipation")} />
        <Toggle checked={options.includeInterventions} label="Interventions" onChange={() => toggle("includeInterventions")} />
        <Toggle checked={options.includeDiagnoses} label="Diagnoses" onChange={() => toggle("includeDiagnoses")} />
        <Toggle checked={options.includeRisk} label="Risk / safety" onChange={() => toggle("includeRisk")} />
        <Toggle checked={options.includeClinicalTags} label="Clinical tags" onChange={() => toggle("includeClinicalTags")} />
        <Toggle checked={options.includeTimeline} label="Session timeline" onChange={() => toggle("includeTimeline")} />
        <Toggle checked={options.includeForensicProgress} label="Forensic progress" onChange={() => toggle("includeForensicProgress")} />
      </div>

      <label style={{ display: "block", marginTop: 12 }}>
        <div className="thera-field-label">Generated summary</div>
        <textarea
          className="thera-input"
          readOnly
          rows={16}
          value={summary}
        />
      </label>

      <div className="thera-filter-row" style={{ marginTop: 10 }}>
        <button type="button" className="thera-action secondary" onClick={() => void copySummary()}>
          Copy Summary
        </button>
        <span className="thera-table-subtext">
          Review the text before any external disclosure.
        </span>
      </div>
      {message && <div className="thera-alert" style={{ marginTop: 10 }}>{message}</div>}
    </section>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
