import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { WorkDrawer } from "../../components/work-drawer";
import { StatusBadge } from "../../components/status-badge";
import { money, shortDate } from "../../lib/format";
import { getClaimErrorGuidance } from "./claim-error-guidance";
import {
  getClaimWorkReferenceData,
  saveClaimIdentityFields,
  type ClaimIdentityValues,
} from "./claim-work-identity";
import type { ClaimWorkRecord } from "./claim-work-drawer";
import {
  getClaimWorkData,
  retryRejectedClaims,
  saveClaimWorkFields,
  type ClaimWorkFieldValues,
} from "./workspace-repository";

type DrawerForm = ClaimWorkFieldValues & ClaimIdentityValues;
type ReferenceData = Awaited<ReturnType<typeof getClaimWorkReferenceData>>;

type Props = {
  claim: ClaimWorkRecord | null;
  messages: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queuePosition?: string;
  onPrevious?: () => void;
  onNext?: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
};

function text(value: unknown, fallback = "—") {
  return value == null || value === "" ? fallback : String(value);
}

function personName(row: Record<string, unknown>) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed";
}

function formFrom(record?: Record<string, unknown>): DrawerForm {
  return {
    client_id: text(record?.client_id, ""),
    payer_id: text(record?.payer_id, ""),
    rendering_provider_id: text(record?.rendering_provider_id, ""),
    patient_control_number: text(record?.patient_control_number, ""),
    payer_claim_number: text(record?.payer_claim_number, ""),
    service_date_from: text(record?.service_date_from, "").slice(0, 10),
    service_date_to: text(record?.service_date_to, "").slice(0, 10),
    place_of_service_code: text(record?.place_of_service_code, ""),
    claim_frequency_code: text(record?.claim_frequency_code, ""),
    total_charge_cents: Number(record?.total_charge_cents ?? 0),
  };
}

export function RejectionWorkDrawer({
  claim,
  messages,
  open,
  onOpenChange,
  queuePosition,
  onPrevious,
  onNext,
  previousDisabled,
  nextDisabled,
}: Props) {
  const [, navigate] = useLocation();
  const [refs, setRefs] = useState<ReferenceData | null>(null);
  const [form, setForm] = useState<DrawerForm>(formFrom());
  const [baseline, setBaseline] = useState<DrawerForm>(formFrom());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline]);

  useEffect(() => {
    if (!open || !claim) return;
    let active = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    void Promise.all([getClaimWorkData(claim.id), getClaimWorkReferenceData()])
      .then(([work, referenceData]) => {
        if (!active) return;
        setRefs(referenceData);
        const next = formFrom(work?.claim);
        setForm(next);
        setBaseline(next);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load rejected claim.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [claim?.id, open]);

  if (!claim) return null;

  function field(key: keyof DrawerForm, value: string | number) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(revalidate: boolean, resubmit: boolean) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (resubmit) await retryRejectedClaims([claim.id]);
      await saveClaimIdentityFields(claim.id, form);
      const result = await saveClaimWorkFields(claim.id, form, revalidate || resubmit);
      const work = await getClaimWorkData(claim.id);
      const next = formFrom(work?.claim);
      setForm(next);
      setBaseline(next);
      const blocked = "ok" in result && result.ok === false && Boolean(result.blocked);
      if (blocked) {
        setNotice("The correction was saved, but validation still found items that require attention.");
        return;
      }
      if (resubmit) {
        setNotice("Corrected claim was revalidated and returned to the submission queue.");
        if (onNext && !nextDisabled) onNext();
      } else if (revalidate) {
        setNotice("Claim was saved and revalidated.");
      } else {
        setNotice("Correction draft saved.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save rejected claim correction.");
    } finally {
      setSaving(false);
    }
  }

  function move(direction: "previous" | "next") {
    if (dirty && !window.confirm("Discard unsaved changes and move to another rejected claim?")) return;
    direction === "previous" ? onPrevious?.() : onNext?.();
  }

  const rejectionMessages = messages.length ? messages : ["Clearinghouse rejected the claim for correction."];
  const footer = (
    <div className="thera-filter-row" style={{ justifyContent: "space-between" }}>
      <button type="button" className="thera-action secondary" onClick={() => onOpenChange(false)}>Cancel</button>
      <div className="thera-filter-row">
        <button type="button" className="thera-action secondary" disabled={saving || !dirty} onClick={() => void save(false, false)}>Save Draft</button>
        <button type="button" className="thera-action secondary" disabled={saving} onClick={() => void save(true, false)}>Revalidate</button>
        <button type="button" className="thera-action" disabled={saving} onClick={() => void save(true, true)}>Resubmit Claim</button>
      </div>
    </div>
  );

  return (
    <WorkDrawer
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty}
      title={claim.clientName}
      subtitle={`${claim.patientControlNumber || "Claim"} · ${claim.payerName || "No payer"} · DOS ${shortDate(claim.serviceDateFrom)}`}
      badges={<StatusBadge value={claim.claimStatus} />}
      queuePosition={queuePosition}
      onPrevious={() => move("previous")}
      onNext={() => move("next")}
      previousDisabled={previousDisabled}
      nextDisabled={nextDisabled}
      openFullRecord={() => navigate(`/claims/${claim.id}`)}
      openFullRecordLabel="Open Full Claim 360"
      footer={footer}
    >
      {notice && <div className="thera-alert" style={{ marginBottom: 16 }}>{notice}</div>}
      {error && <div className="thera-state error" style={{ marginBottom: 16 }}>{error}</div>}
      {loading ? <div className="thera-state">Loading rejection correction...</div> : (
        <div className="thera-stack">
          <section className="thera-card">
            <h2>Rejection reason</h2>
            <div style={{ display: "grid", gap: 12 }}>
              {rejectionMessages.map((message, index) => {
                const guidance = getClaimErrorGuidance(message);
                return (
                  <div key={`${message}-${index}`} className="thera-card">
                    <strong>{message}</strong>
                    {guidance ? <>
                      <div className="thera-table-subtext" style={{ marginTop: 6 }}>Why it matters</div>
                      <div>{guidance.whyItMatters}</div>
                      <div className="thera-table-subtext" style={{ marginTop: 6 }}>Correction needed</div>
                      <div>{guidance.correction}</div>
                    </> : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="thera-card">
            <div className="thera-card-header"><div><h2>Claim correction</h2><p>Compare the submitted value with the corrected value before revalidating.</p></div></div>
            <div className="thera-form-grid" style={{ marginBottom: 12 }}>
              <div><div className="thera-table-subtext">Current value</div><strong>{claim.clientName}</strong></div>
              <label>Corrected value<select className="thera-input" value={form.client_id} onChange={(e) => field("client_id", e.target.value)}><option value="">Select patient</option>{(refs?.clients ?? []).map((row) => <option key={row.id} value={row.id}>{personName(row)}</option>)}</select></label>
              <div><div className="thera-table-subtext">Current payer</div><strong>{claim.payerName || "—"}</strong></div>
              <label>Corrected payer<select className="thera-input" value={form.payer_id} onChange={(e) => field("payer_id", e.target.value)}><option value="">Select payer</option>{(refs?.payers ?? []).map((row) => <option key={row.id} value={row.id}>{text(row.name, "Payer")}</option>)}</select></label>
              <div><div className="thera-table-subtext">Current rendering provider</div><strong>{claim.renderingProviderName || "—"}</strong></div>
              <label>Corrected rendering provider<select className="thera-input" value={form.rendering_provider_id} onChange={(e) => field("rendering_provider_id", e.target.value)}><option value="">Select provider</option>{(refs?.providers ?? []).map((row) => <option key={row.id} value={row.id}>{personName(row)}{row.credentials ? `, ${String(row.credentials)}` : ""}</option>)}</select></label>
              <div><div className="thera-table-subtext">Current patient control #</div><strong>{claim.patientControlNumber || "—"}</strong></div>
              <label>Corrected patient control #<input className="thera-input" value={form.patient_control_number} onChange={(e) => field("patient_control_number", e.target.value)} /></label>
              <div><div className="thera-table-subtext">Current payer claim #</div><strong>{claim.payerClaimNumber || "—"}</strong></div>
              <label>Corrected payer claim #<input className="thera-input" value={form.payer_claim_number} onChange={(e) => field("payer_claim_number", e.target.value)} /></label>
              <div><div className="thera-table-subtext">Current DOS</div><strong>{shortDate(claim.serviceDateFrom)}</strong></div>
              <label>Corrected DOS<input className="thera-input" type="date" value={form.service_date_from} onChange={(e) => field("service_date_from", e.target.value)} /></label>
              <div><div className="thera-table-subtext">Current charge</div><strong>{money(claim.totalChargeCents)}</strong></div>
              <label>Corrected charge<input className="thera-input" type="number" min="0" step="0.01" value={(form.total_charge_cents / 100).toFixed(2)} onChange={(e) => field("total_charge_cents", Math.round(Number(e.target.value || 0) * 100))} /></label>
              <label>Place of service<input className="thera-input" value={form.place_of_service_code} onChange={(e) => field("place_of_service_code", e.target.value)} /></label>
              <label>Claim frequency<input className="thera-input" value={form.claim_frequency_code} onChange={(e) => field("claim_frequency_code", e.target.value)} /></label>
            </div>
          </section>
        </div>
      )}
    </WorkDrawer>
  );
}
