import {
  PSYCHEDELIC_PHENOMENON_OPTIONS,
  formatPsychedelicContextForNote,
  psychedelicPhaseForTemplate,
  type PsychedelicContext,
  type PsychedelicPhenomenon,
} from "./psychedelic-context";
import type { DocumentationTemplate } from "./clinical-context";

type Props = {
  signed: boolean;
  templateType: DocumentationTemplate;
  value: PsychedelicContext;
  onChange: (next: PsychedelicContext) => void;
  onInsertIntoNote: (text: string) => void;
};

export function PsychedelicSpecialtyPanel(props: Props) {
  const phase = psychedelicPhaseForTemplate(props.templateType);
  const value = props.value.phase === phase ? props.value : { ...props.value, phase };

  function patch(values: Partial<PsychedelicContext>) {
    props.onChange({ ...value, ...values, phase });
  }

  function togglePhenomenon(item: PsychedelicPhenomenon) {
    const has = value.phenomena.includes(item);
    patch({
      phenomena: has
        ? value.phenomena.filter((current) => current !== item)
        : [...value.phenomena, item],
    });
  }

  return (
    <div className="thera-card" style={{ padding: 12 }}>
      <div>
        <strong>PAT / KAP Specialty Context</strong>
        <div className="thera-table-subtext">
          Documentation support only. THERASSISTANT does not generate dosing recommendations,
          medication protocols, diagnosis conclusions, or payer coverage determinations.
        </div>
      </div>

      <div className="thera-form-grid" style={{ marginTop: 10 }}>
        <label>
          Treatment model / context
          <input
            className="thera-input"
            disabled={props.signed}
            value={value.treatmentModel}
            onChange={(event) => patch({ treatmentModel: event.target.value })}
            placeholder="Provider-entered practice or treatment context"
          />
        </label>
        <div>
          <div className="thera-field-label">Current phase</div>
          <div className="thera-field-value">{phase.replaceAll("_", " ")}</div>
        </div>
      </div>

      {phase === "preparation" && (
        <div className="thera-form-grid" style={{ marginTop: 10 }}>
          <label style={{ gridColumn: "1 / -1" }}>
            Screening / readiness context
            <textarea
              className="thera-input"
              disabled={props.signed}
              value={value.screeningReadiness}
              onChange={(event) => patch({ screeningReadiness: event.target.value })}
              placeholder="Provider-entered readiness, screening, consent, or coordination context."
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Patient-stated intention
            <textarea
              className="thera-input"
              disabled={props.signed}
              value={value.intention}
              onChange={(event) => patch({ intention: event.target.value })}
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Support / logistics plan
            <textarea
              className="thera-input"
              disabled={props.signed}
              value={value.supportPlan}
              onChange={(event) => patch({ supportPlan: event.target.value })}
              placeholder="Transportation, support person, care coordination, or other provider-entered logistics."
            />
          </label>
        </div>
      )}

      {phase === "medicine_session" && (
        <>
          <div className="thera-form-grid" style={{ marginTop: 10 }}>
            <label style={{ gridColumn: "1 / -1" }}>
              Medicine / natural-medicine context
              <textarea
                className="thera-input"
                disabled={props.signed}
                value={value.medicineContext}
                onChange={(event) => patch({ medicineContext: event.target.value })}
                placeholder="Record only the treating team's documented medication or natural-medicine context."
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Administration context
              <textarea
                className="thera-input"
                disabled={props.signed}
                value={value.administrationContext}
                onChange={(event) => patch({ administrationContext: event.target.value })}
                placeholder="Provider-entered route, setting, or administration context when clinically relevant."
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Provider observations / monitoring
              <textarea
                className="thera-input"
                disabled={props.signed}
                value={value.monitoringObservations}
                onChange={(event) => patch({ monitoringObservations: event.target.value })}
                placeholder="Objective observations and monitoring documented by the treating team."
              />
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="thera-field-label">Experience descriptors</div>
            <div className="thera-table-subtext">
              Provider-selected descriptors only; these do not assign a diagnosis.
            </div>
            <div className="thera-filter-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
              {PSYCHEDELIC_PHENOMENON_OPTIONS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  disabled={props.signed}
                  className={value.phenomena.includes(item.id) ? "thera-action" : "thera-action secondary"}
                  onClick={() => togglePhenomenon(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <label style={{ display: "block", marginTop: 12 }}>
            Recovery / grounding
            <textarea
              className="thera-input"
              disabled={props.signed}
              value={value.recoveryGrounding}
              onChange={(event) => patch({ recoveryGrounding: event.target.value })}
            />
          </label>

          <div className="thera-table-subtext" style={{ marginTop: 8 }}>
            Use the Session Timeline below to timestamp clinically important events during an extended encounter.
          </div>
        </>
      )}

      {phase === "integration" && (
        <div className="thera-form-grid" style={{ marginTop: 10 }}>
          <label style={{ gridColumn: "1 / -1" }}>
            Integration themes
            <textarea
              className="thera-input"
              disabled={props.signed}
              value={value.integrationThemes}
              onChange={(event) => patch({ integrationThemes: event.target.value })}
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Functional impact
            <textarea
              className="thera-input"
              disabled={props.signed}
              value={value.functionalImpact}
              onChange={(event) => patch({ functionalImpact: event.target.value })}
              placeholder="Patient-specific functional changes, goals, or barriers discussed in integration."
            />
          </label>
        </div>
      )}

      <label style={{ display: "block", marginTop: 12 }}>
        Provider narrative
        <textarea
          className="thera-input"
          disabled={props.signed}
          value={value.providerNarrative}
          onChange={(event) => patch({ providerNarrative: event.target.value })}
          placeholder="Patient-specific clinical observations and treatment context."
        />
      </label>

      {!props.signed && (
        <button
          type="button"
          className="thera-action secondary"
          style={{ marginTop: 12 }}
          onClick={() => props.onInsertIntoNote("\n" + formatPsychedelicContextForNote(value) + "\n")}
        >
          Insert PAT/KAP Context into Note
        </button>
      )}
    </div>
  );
}
