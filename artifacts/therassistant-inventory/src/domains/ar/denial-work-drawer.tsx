import { useEffect, useMemo, useState } from "react";

import { WorkDrawer } from "../../components/work-drawer";
import { StatusBadge } from "../../components/status-badge";
import { money, shortDate } from "../../lib/format";
import type { DenialQueueRow } from "./denials-queue-repository";
import type { DenialFollowUpInput } from "./denial-follow-up";

function value(input: unknown, fallback = "—") {
  return input == null || input === "" ? fallback : String(input);
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="thera-table-subtext">{label}</div><strong>{children}</strong></div>;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: DenialQueueRow | null;
  saving?: boolean;
  queuePosition?: string;
  onPrevious?: () => void;
  onNext?: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  onStartWork: (row: DenialQueueRow) => void;
  onCreateAppeal: (row: DenialQueueRow) => void;
  onWriteOff: (row: DenialQueueRow) => void;
  onCorrectClaim: (row: DenialQueueRow) => void;
  onSaveFollowUp: (row: DenialQueueRow, input: DenialFollowUpInput) => Promise<void> | void;
};

export function DenialWorkDrawer({
  open,
  onOpenChange,
  row,
  saving = false,
  queuePosition,
  onPrevious,
  onNext,
  previousDisabled,
  nextDisabled,
  onStartWork,
  onCreateAppeal,
  onWriteOff,
  onCorrectClaim,
  onSaveFollowUp,
}: Props) {
  const [payerReferenceNumber, setPayerReferenceNumber] = useState("");
  const [nextFollowUpDate, setNextFollowUpDate] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || !row) return;
    setPayerReferenceNumber("");
    setNextFollowUpDate("");
    setActionTaken("");
    setNotes("");
  }, [open, row?.id]);

  const dirty = useMemo(
    () => Boolean(payerReferenceNumber || nextFollowUpDate || actionTaken || notes),
    [payerReferenceNumber, nextFollowUpDate, actionTaken, notes],
  );

  if (!row) return null;

  const followUpInput: DenialFollowUpInput = {
    payerReferenceNumber,
    nextFollowUpDate,
    actionTaken,
    notes,
  };

  const footer = (
    <div className="thera-filter-row" style={{ justifyContent: "space-between" }}>
      <button type="button" className="thera-action secondary" onClick={() => onOpenChange(false)}>Close</button>
      <div className="thera-filter-row">
        {row.claim_id ? <button type="button" className="thera-action secondary" disabled={saving} onClick={() => onCorrectClaim(row)}>Correct Claim</button> : null}
        {row.policy === "auto_writeoff"
          ? <button type="button" className="thera-action" disabled={saving || row.denial_status === "resolved_writeoff"} onClick={() => onWriteOff(row)}>Write Off</button>
          : <>
            <button type="button" className="thera-action secondary" disabled={saving} onClick={() => onStartWork(row)}>Start Follow-Up</button>
            <button type="button" className="thera-action" disabled={saving || Boolean(row.activeAppealId)} onClick={() => onCreateAppeal(row)}>{row.activeAppealId ? "Appeal Active" : "Create Appeal"}</button>
          </>}
      </div>
    </div>
  );

  return (
    <WorkDrawer
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty}
      title={row.clientName}
      subtitle={`${row.claimNumber} · ${row.payerName}`}
      badges={<><StatusBadge value={value(row.denial_status, "new")} /><StatusBadge value={value(row.workability ?? row.policy)} /></>}
      queuePosition={queuePosition}
      onPrevious={onPrevious}
      onNext={onNext}
      previousDisabled={previousDisabled}
      nextDisabled={nextDisabled}
      openFullRecord={row.claim_id ? () => { window.location.href = `/claims/${String(row.claim_id)}`; } : undefined}
      openFullRecordLabel="Open Full Claim 360"
      footer={footer}
    >
      <section className="thera-card" style={{ marginBottom: 16 }}>
        <div className="thera-form-grid">
          <Fact label="Patient">{row.clientName}</Fact>
          <Fact label="Claim">{row.claimNumber}</Fact>
          <Fact label="Payer claim #">{row.payerClaimNumber}</Fact>
          <Fact label="Payer">{row.payerName}</Fact>
          <Fact label="DOS">{row.serviceDate ? shortDate(row.serviceDate) : "—"}</Fact>
          <Fact label="Rendering provider">{row.providerName}</Fact>
          <Fact label="Charge amount">{money(row.chargeAmountCents)}</Fact>
          <Fact label="Allowed amount">{money(row.allowedAmountCents)}</Fact>
          <Fact label="Paid amount">{money(row.paidAmountCents)}</Fact>
          <Fact label="Denied amount">{money(Number(row.amount_cents ?? 0))}</Fact>
          <Fact label="CARC">{value(row.carc_code)}</Fact>
          <Fact label="RARC">{value(row.rarc_code)}</Fact>
          <Fact label="Denial category">{value(row.denial_category, "other").replaceAll("_", " ")}</Fact>
          <Fact label="Workability">{value(row.workability ?? row.policy)}</Fact>
          <Fact label="Appeal deadline">{row.timely_filing_deadline ? shortDate(String(row.timely_filing_deadline)) : "—"}</Fact>
          <Fact label="Claim status">{value(row.claimStatus)}</Fact>
        </div>
      </section>

      <section className="thera-card" style={{ marginBottom: 16 }}>
        <h2>Denial reason</h2>
        <p>{value(row.reason, "No denial reason recorded.")}</p>
      </section>

      <section className="thera-card" style={{ marginBottom: 16 }}>
        <div className="thera-card-header">
          <div>
            <h2>Follow-up activity</h2>
            <p>Document the payer contact, outcome, and next action without leaving the denial queue.</p>
          </div>
        </div>
        <div className="thera-form-grid">
          <label>Payer reference number<input className="thera-input" value={payerReferenceNumber} onChange={(event) => setPayerReferenceNumber(event.target.value)} /></label>
          <label>Next follow-up date<input className="thera-input" type="date" value={nextFollowUpDate} onChange={(event) => setNextFollowUpDate(event.target.value)} /></label>
          <label style={{ gridColumn: "1 / -1" }}>Action taken<input className="thera-input" value={actionTaken} onChange={(event) => setActionTaken(event.target.value)} placeholder="Called payer, corrected claim, requested reconsideration..." /></label>
          <label style={{ gridColumn: "1 / -1" }}>Notes<textarea className="thera-input" rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        </div>
        <div className="thera-filter-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" className="thera-action" disabled={saving || (!actionTaken.trim() && !notes.trim())} onClick={() => void onSaveFollowUp(row, followUpInput)}>Save Follow-Up</button>
        </div>
      </section>

      <section className="thera-card">
        <h2>Existing notes / activity</h2>
        <p>{value(row.notes, "No denial notes recorded.")}</p>
      </section>
    </WorkDrawer>
  );
}
