import {
  cssrsItems,
  gadItems,
  phqItems,
  type ScreenerSummary,
} from "../portal/portal-screeners";
import "./pre-visit-screeners-panel.css";

const frequencyLabels = [
  "Not at all",
  "Several days",
  "More than half the days",
  "Nearly every day",
];

type Props = {
  screeners: ScreenerSummary | null;
  compact?: boolean;
};

export function PreVisitScreenersPanel({ screeners, compact = false }: Props) {
  if (!screeners) {
    return <div className="previsit-screeners-empty">No submitted screening questionnaires are linked to this visit.</div>;
  }

  if (screeners.declined) {
    return (
      <section className="previsit-screeners-panel declined" aria-label="Patient-reported pre-visit screeners">
        <div className="previsit-screeners-heading">
          <div>
            <span className="thera-eyebrow">PATIENT-REPORTED SCREENING</span>
            <strong>Screeners deferred by patient</strong>
          </div>
          <span className="previsit-screeners-state">Discuss in visit</span>
        </div>
        <p>The patient chose to discuss screening with the provider instead of completing the questionnaires. No scores were generated.</p>
      </section>
    );
  }

  return (
    <section className={`previsit-screeners-panel${compact ? " compact" : ""}`} aria-label="Patient-reported pre-visit screeners">
      <div className="previsit-screeners-heading">
        <div>
          <span className="thera-eyebrow">PATIENT-REPORTED SCREENING</span>
          <strong>Submitted questionnaire responses</strong>
        </div>
        <span className={screeners.complete ? "previsit-screeners-state complete" : "previsit-screeners-state incomplete"}>
          {screeners.complete ? "Submitted" : "Incomplete"}
        </span>
      </div>

      <p className="previsit-screeners-disclaimer">These are patient-reported questionnaire responses. They do not establish a diagnosis or clinician risk classification.</p>

      <div className="previsit-screeners-metrics">
        <ScreenerMetric label="PHQ-9" value={screeners.phq9Total === null ? "Incomplete" : String(screeners.phq9Total)} />
        <ScreenerMetric label="GAD-7" value={screeners.gad7Total === null ? "Incomplete" : String(screeners.gad7Total)} />
        <ScreenerMetric label="C-SSRS" value={screeners.cssrsSubmitted ? "Submitted" : "Incomplete"} attention={screeners.cssrsPositiveItems.length > 0} />
      </div>

      <details className="previsit-screeners-details">
        <summary>Review questionnaire responses</summary>
        <div className="previsit-screeners-response-groups">
          <ResponseGroup
            title="PHQ-9"
            items={phqItems}
            responses={screeners.phq9Responses}
            format={(value) => typeof value === "number" ? frequencyLabels[value] ?? String(value) : "Not answered"}
          />
          <ResponseGroup
            title="GAD-7"
            items={gadItems}
            responses={screeners.gad7Responses}
            format={(value) => typeof value === "number" ? frequencyLabels[value] ?? String(value) : "Not answered"}
          />
          <ResponseGroup
            title="C-SSRS"
            items={cssrsItems}
            responses={screeners.cssrsResponses}
            format={(value) => value === true ? "Yes" : value === false ? "No" : "Not asked / not answered"}
          />
        </div>
      </details>
    </section>
  );
}

function ScreenerMetric({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
  return (
    <div className={attention ? "previsit-screener-metric attention" : "previsit-screener-metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
      {attention ? <small>Review responses</small> : null}
    </div>
  );
}

function ResponseGroup<T extends number | boolean | null>({
  title,
  items,
  responses,
  format,
}: {
  title: string;
  items: string[];
  responses: T[];
  format: (value: T) => string;
}) {
  return (
    <div className="previsit-screener-response-group">
      <strong>{title}</strong>
      <div className="previsit-screener-response-list">
        {items.map((item, index) => (
          <div className="previsit-screener-response" key={`${title}-${index}`}>
            <span>{index + 1}. {item}</span>
            <b>{format(responses[index] as T)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
