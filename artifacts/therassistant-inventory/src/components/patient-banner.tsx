import type { ReactNode } from "react";
import { Link } from "wouter";

import { StatusBadge } from "./status-badge";
import { buildPatientBannerModel, type PatientBannerInput } from "./patient-banner-model";

type Props = PatientBannerInput & {
  contextLabel?: string;
  actions?: ReactNode;
};

export function PatientBanner({ contextLabel = "Patient", actions, ...input }: Props) {
  const model = buildPatientBannerModel(input);
  return (
    <section className="patient-banner" aria-label={`${model.name} patient context`}>
      <div className="patient-banner-identity">
        <div className="thera-eyebrow">{contextLabel}</div>
        <div className="patient-banner-name-row">
          <Link href={`/clients/${model.patientId}`} className="patient-banner-name">{model.name}</Link>
          <StatusBadge value={model.patientStatus} />
        </div>
        <div className="patient-banner-demographics">
          <span><strong>DOB</strong> {model.dob}</span>
          <span><strong>Pronouns</strong> {model.pronouns}</span>
          <span><strong>MRN</strong> {model.mrn}</span>
        </div>
      </div>
      <div className="patient-banner-facts">
        <BannerFact label="Payer" value={model.payerName} />
        <div className="patient-banner-fact"><span>Eligibility</span><StatusBadge value={model.eligibilityStatus} /></div>
        <BannerFact label="Balance" value={model.balanceLabel} />
        <BannerFact label="Next Visit" value={model.nextVisitLabel} />
      </div>
      {actions ? <div className="patient-banner-actions">{actions}</div> : null}
    </section>
  );
}

function BannerFact({ label, value }: { label: string; value: string }) {
  return <div className="patient-banner-fact"><span>{label}</span><strong>{value}</strong></div>;
}
