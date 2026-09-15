import { useState } from "react";
import { useLocation } from "wouter";
import { WorkDrawer } from "../../components/work-drawer";
import { StatusBadge } from "../../components/status-badge";
import { money, shortDate } from "../../lib/format";
import type { ClaimWorkSection } from "./claim-work-drawer.types";

export type ClaimWorkRecord = {
  id: string;
  patientControlNumber?: string | null;
  payerClaimNumber?: string | null;
  claimStatus: string;
  serviceDateFrom?: string | null;
  totalChargeCents?: number;
  clientName: string;
  payerName?: string | null;
  renderingProviderName?: string | null;
};

type Props = {
  claim: ClaimWorkRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queuePosition?: string;
  onPrevious?: () => void;
  onNext?: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
};

const sections: Array<[ClaimWorkSection, string]> = [
  ["fields", "Claim Fields"],
  ["lines", "Claim Lines"],
  ["diagnoses", "Diagnoses"],
  ["validation", "Validation Errors"],
  ["responses", "Clearinghouse Responses"],
  ["rejections", "Rejections"],
  ["denials", "Denials"],
  ["appeals", "Appeals"],
  ["work-items", "Work Items"],
  ["history", "Notes / History"],
];

export function ClaimWorkDrawer({ claim, open, onOpenChange, queuePosition, onPrevious, onNext, previousDisabled, nextDisabled }: Props) {
  const [, navigate] = useLocation();
  const [section, setSection] = useState<ClaimWorkSection>("fields");

  if (!claim) return null;

  return (
    <WorkDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={claim.clientName}
      subtitle={`${claim.patientControlNumber || "Claim"} · ${claim.payerName || "No payer"} · DOS ${shortDate(claim.serviceDateFrom)}`}
      badges={<StatusBadge value={claim.claimStatus} />}
      queuePosition={queuePosition}
      onPrevious={onPrevious}
      onNext={onNext}
      previousDisabled={previousDisabled}
      nextDisabled={nextDisabled}
      openFullRecord={() => navigate(`/claims/${claim.id}`)}
      openFullRecordLabel="Open Full Claim 360"
      footer={<div className="thera-filter-row"><button type="button" className="thera-action secondary" onClick={() => onOpenChange(false)}>Close</button></div>}
    >
      <section className="thera-card" style={{ marginBottom: "1rem" }}>
        <div className="thera-filter-row">
          <strong>Claim:</strong> {claim.patientControlNumber || "No control number"}
          <strong>Payer claim #:</strong> {claim.payerClaimNumber || "Not assigned"}
          <strong>Rendering:</strong> {claim.renderingProviderName || "Not assigned"}
          <strong>Charge:</strong> {money(claim.totalChargeCents)}
        </div>
      </section>

      <div className="thera-filter-row" role="tablist" aria-label="Claim work sections" style={{ marginBottom: "1rem" }}>
        {sections.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={section === key} className={`thera-action ${section === key ? "" : "secondary"}`} onClick={() => setSection(key)}>{label}</button>
        ))}
      </div>

      <section className="thera-card">
        <h2>{sections.find(([key]) => key === section)?.[1]}</h2>
        {section === "fields" ? <p>Claim field editing will be available here without leaving the workqueue.</p> : <div className="thera-state">No {sections.find(([key]) => key === section)?.[1].toLowerCase()} are recorded for this claim.</div>}
      </section>
    </WorkDrawer>
  );
}
