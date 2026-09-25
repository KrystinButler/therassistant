import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";

import { WorkDrawer } from "../../components/work-drawer";
import { StatusBadge } from "../../components/status-badge";
import { money, shortDate } from "../../lib/format";
import { Icd10SearchInput } from "../coding/Icd10SearchInput";
import { deriveClaimValidationIssues, getClaimRejectionIssue, type ClaimCorrectionTarget } from "./claim-error-guidance";
import {
  getClaimWorkReferenceData,
  type ClaimIdentityValues,
} from "./claim-work-identity";
import type { ClaimWorkRecord } from "./claim-work-drawer";
import { createBatch, validateClaim } from "./repository";
import {
  getClaimWorkData,
  saveAtomicRejectionCorrections,
  type ClaimDiagnosisCorrection,
  type ClaimLineCorrection,
  type ClaimWorkData,
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
    billing_provider_id: text(record?.billing_provider_id, ""),
    patient_control_number: text(record?.patient_control_number, ""),
    payer_claim_number: text(record?.payer_claim_number, ""),
    service_date_from: text(record?.service_date_from, "").slice(0, 10),
    service_date_to: text(record?.service_date_to, "").slice(0, 10),
    total_charge_cents: Number(record?.total_charge_cents ?? 0),
  };
}

function lineForms(rows: ClaimWorkData["lines"] = []): ClaimLineCorrection[] {
  return rows.map((row) => ({
    id: row.id,
    service_date: text(row.service_date, "").slice(0, 10),
    cpt_code: text(row.cpt_code, ""),
    modifier1: text(row.modifier1, ""),
    modifier2: text(row.modifier2, ""),
    diagnosis_pointer: text(row.diagnosis_pointer, ""),
    place_of_service: text(row.place_of_service, ""),
    units: Number(row.units ?? 1),
    charge_amount_cents: Number(row.charge_amount_cents ?? 0),
  }));
}

function diagnosisForms(rows: ClaimWorkData["diagnoses"] = []): ClaimDiagnosisCorrection[] {
  return rows.map((row) => ({
    id: row.id,
    diagnosis_code: text(row.diagnosis_code, ""),
    pointer_order: Number(row.pointer_order ?? 1),
  }));
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
  const [workData, setWorkData] = useState<ClaimWorkData | null>(null);
  const [form, setForm] = useState<DrawerForm>(formFrom());
  const [baseline, setBaseline] = useState<DrawerForm>(formFrom());
  const [lines, setLines] = useState<ClaimLineCorrection[]>([]);
  const [lineBaseline, setLineBaseline] = useState<ClaimLineCorrection[]>([]);
  const [diagnoses, setDiagnoses] = useState<ClaimDiagnosisCorrection[]>([]);
  const [diagnosisBaseline, setDiagnosisBaseline] = useState<ClaimDiagnosisCorrection[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resubmissionPrepared, setResubmissionPrepared] = useState(false);
  const pendingCorrectionRef = useRef<{ fingerprint: string; id: string } | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baseline)
      || JSON.stringify(lines) !== JSON.stringify(lineBaseline)
      || JSON.stringify(diagnoses) !== JSON.stringify(diagnosisBaseline),
    [form, baseline, lines, lineBaseline, diagnoses, diagnosisBaseline],
  );

  function applyWork(work: ClaimWorkData | null) {
    setWorkData(work);
    const next = formFrom(work?.claim);
    const nextLines = lineForms(work?.lines);
    const nextDiagnoses = diagnosisForms(work?.diagnoses);
    setForm(next);
    setBaseline(next);
    setLines(nextLines);
    setLineBaseline(nextLines);
    setDiagnoses(nextDiagnoses);
    setDiagnosisBaseline(nextDiagnoses);
  }

  useEffect(() => {
    if (!open || !claim) return;
    let active = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    setResubmissionPrepared(false);
    pendingCorrectionRef.current = null;

    void Promise.all([getClaimWorkData(claim.id), getClaimWorkReferenceData()])
      .then(([work, referenceData]) => {
        if (!active) return;
        setRefs(referenceData);
        applyWork(work);
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
  const activeClaim = claim;

  function field(key: keyof DrawerForm, value: string | number) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(revalidate: boolean, resubmit: boolean) {
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      // Validate new required rows before any partial database write.
      for (const [index, line] of lines.entries()) {
        if (line.id.startsWith("new:") && (!line.service_date || !line.cpt_code.trim() || line.units <= 0 || line.charge_amount_cents <= 0)) {
          throw new Error("Line " + (index + 1) + ": Complete service date, CPT/HCPCS, positive units, and charge.");
        }
      }
      if (diagnoses.some((row) => row.id.startsWith("new:") && !row.diagnosis_code.trim())) {
        throw new Error("Select an ICD-10-CM diagnosis before saving.");
      }
      // Reuse the request ID if a network failure hides the result of a committed save.
      const fingerprint = JSON.stringify({ claim: activeClaim.id, form, lines, diagnoses, revalidate: revalidate || resubmit });
      const pending = pendingCorrectionRef.current;
      const requestId = pending?.fingerprint === fingerprint ? pending.id : crypto.randomUUID();
      pendingCorrectionRef.current = { fingerprint, id: requestId };
      await saveAtomicRejectionCorrections(activeClaim.id, requestId, form, lines, diagnoses, revalidate || resubmit);
      const result = revalidate || resubmit ? await validateClaim(activeClaim.id) : { kind: "success" as const };
      const blocked = "ok" in result && result.ok === false && Boolean(result.blocked);
      if ("ok" in result && !result.ok && !result.blocked) {
        setError("Corrections were saved, but revalidation could not finish: " + result.message + " Retry to revalidate.");
        return;
      }

      const work = await getClaimWorkData(activeClaim.id);
      applyWork(work);
      pendingCorrectionRef.current = null;

      if (blocked) {
        setNotice("The correction was saved, but revalidation still found items that require attention: " + ("details" in result && Array.isArray(result.details) ? result.details.join(" ") : ""));
        return;
      }

      if (resubmit) {
        const batch = await createBatch(
          [activeClaim.id],
          `Corrected claim ${activeClaim.patientControlNumber || activeClaim.id}`,
        );
        if (!batch.ok) {
          throw new Error(batch.message || "Unable to create corrected-claim submission batch.");
        }
        setResubmissionPrepared(true);
        setNotice("The rejection cleared. The corrected claim is ready in a new 837P batch for resubmission.");
      } else if (revalidate) {
        setNotice("The rejection correction was saved and the claim passed revalidation.");
      } else {
        setNotice("Correction draft saved.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save rejected claim correction.");
    } finally {
      setSaving(false);
    }
  }

  function navigateSafely(path: string) {
    if (dirty && !window.confirm("Discard unsaved claim corrections and leave this claim?")) return;
    navigate(path);
  }

  function move(direction: "previous" | "next") {
    if (dirty && !window.confirm("Discard unsaved changes and move to another rejected claim?")) return;
    direction === "previous" ? onPrevious?.() : onNext?.();
  }

  function focusTarget(target: ClaimCorrectionTarget, field?: string, lineNumber?: number) {
    if (target === "patient" && form.client_id) {
      navigateSafely(`/clients/${form.client_id}?tab=demographics`);
      return;
    }
    if (target === "subscriber") {
      if (form.client_id) navigateSafely(`/clients/${form.client_id}?tab=coverage`);
      return;
    }

    const id = target === "claim_lines"
      ? field && lineNumber && lineNumber <= lines.length
        ? `rejection-line-${lineNumber}-${field}`
        : "rejection-field-claim-lines"
      : target === "diagnoses"
        ? "rejection-field-diagnoses"
        : `rejection-field-${target}`;

    window.setTimeout(() => {
      const container = document.getElementById(id);
      const control = container?.matches("input, select, textarea")
        ? container as HTMLElement
        : container?.querySelector<HTMLElement>("input, select, textarea, button");
      container?.scrollIntoView({ behavior: "smooth", block: "center" });
      control?.focus();
    }, 0);
  }

  const isValidationHold = String(workData?.claim?.claim_status ?? activeClaim.claimStatus) === "validation_failed";
  const rejectedResponses = isValidationHold ? [] : (workData?.responses ?? []).filter(
    (row) => String(row.response_status ?? "").toLowerCase() === "rejected",
  );
  const rejectionIssues = rejectedResponses.slice(0, 1).flatMap((row) =>
    text(row.response_message, "Clearinghouse rejected the claim for correction.")
      .split(/(?<=\.)\s+/).filter(Boolean).map((message) => ({
        message,
        code: text(row.response_code, ""),
        issue: getClaimRejectionIssue({
          responseCode: row.response_code,
          responseMessage: message,
          rawResponse: row.raw_response,
        }),
      })),
  );
  const validationMessages = isValidationHold && workData
    ? deriveClaimValidationIssues(workData.claim, workData.lines, workData.diagnoses)
    : [];
  for (const message of [...validationMessages, ...messages]) {
    if (!rejectionIssues.some((entry) => entry.message === message)) {
      rejectionIssues.push({ message, code: "", issue: getClaimRejectionIssue({ responseMessage: message }) });
    }
  }

  if (!rejectionIssues.length) {
    for (const message of (messages.length ? messages : ["Clearinghouse rejected the claim for correction."])) {
      rejectionIssues.push({
        message,
        code: "",
        issue: getClaimRejectionIssue({ responseMessage: message }),
      });
    }
  }

  const footer = (
    <div className="thera-filter-row" style={{ justifyContent: "space-between" }}>
      <button type="button" className="thera-action secondary" onClick={() => onOpenChange(false)}>Cancel</button>
      <div className="thera-filter-row">
        <button
          type="button"
          className="thera-action secondary"
          disabled={saving || !dirty}
          onClick={() => void save(false, false)}
        >
          Save Draft
        </button>
        <button
          type="button"
          className="thera-action secondary"
          disabled={saving}
          onClick={() => void save(true, false)}
        >
          Revalidate
        </button>
        <button
          type="button"
          className="thera-action"
          disabled={saving || resubmissionPrepared}
          onClick={() => void save(true, true)}
        >
          Prepare Resubmission
        </button>
      </div>
    </div>
  );

  return (
    <WorkDrawer
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty}
      title={activeClaim.clientName}
      subtitle={`${activeClaim.patientControlNumber || "Claim"} · ${activeClaim.payerName || "No payer"} · DOS ${shortDate(activeClaim.serviceDateFrom)}`}
      badges={<StatusBadge value={activeClaim.claimStatus} />}
      queuePosition={queuePosition}
      onPrevious={() => move("previous")}
      onNext={() => move("next")}
      previousDisabled={previousDisabled}
      nextDisabled={nextDisabled}
      openFullRecord={() => navigateSafely(`/claims/${activeClaim.id}`)}
      openFullRecordLabel="Open Full Claim 360"
      footer={footer}
    >
      {notice && <div className="thera-alert" style={{ marginBottom: 16 }}>{notice}</div>}
      {error && <div className="thera-state error" style={{ marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div className="thera-state">Loading rejection correction...</div>
      ) : (
        <div className="thera-stack">
          <section className="thera-card">
            <div className="thera-card-header">
              <div>
                <h2>{isValidationHold ? "Claim validation hold" : "Clearinghouse rejection"}</h2>
                <p>{isValidationHold ? "Correct the current validation errors before preparing this claim." : "Fix the field identified by the clearinghouse, then revalidate before resubmission."}</p>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {rejectionIssues.map(({ message, code, issue }, index) => (
                <div key={`${code}-${message}-${index}`} className="thera-card">
                  <div className="thera-filter-row" style={{ justifyContent: "space-between" }}>
                    <strong>{code ? `Rejection ${code}` : isValidationHold ? "Validation issue" : "Rejection"}</strong>
                    {issue?.acknowledgementType ? (
                      <span className="thera-table-subtext">{issue.acknowledgementType}</span>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 6 }}>{message}</div>

                  {issue ? (
                    <>
                      <div className="thera-table-subtext" style={{ marginTop: 8 }}>Why it matters</div>
                      <div>{issue.whyItMatters}</div>
                      <div className="thera-table-subtext" style={{ marginTop: 8 }}>Correction needed</div>
                      <div>{issue.correction}</div>
                      <button
                        type="button"
                        className="thera-action secondary"
                        style={{ marginTop: 10 }}
                        onClick={() => focusTarget(issue.target, issue.field, issue.lineNumber)}
                      >
                        {issue.actionLabel}
                      </button>
                    </>
                  ) : (
                    <div className="thera-table-subtext" style={{ marginTop: 8 }}>
                      No exact field mapping is available for this clearinghouse message. Review the raw acknowledgement before editing.
                      <button type="button" className="thera-action secondary" onClick={() => navigateSafely(`/claims/${activeClaim.id}`)}>Open raw response in Claim 360</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="thera-card">
            <div className="thera-card-header">
              <div>
                <h2>Claim-level fields</h2>
                <p>Correct claim identity, payer, provider, dates, and total charge here.</p>
              </div>
            </div>

            <div className="thera-form-grid">
              <label id="rejection-field-patient">
                Patient
                <select className="thera-input" value={form.client_id} onChange={(e) => field("client_id", e.target.value)}>
                  <option value="">Select patient</option>
                  {(refs?.clients ?? []).map((row) => <option key={row.id} value={row.id}>{personName(row)}</option>)}
                </select>
              </label>

              <label id="rejection-field-payer">
                Payer
                <select className="thera-input" value={form.payer_id} onChange={(e) => field("payer_id", e.target.value)}>
                  <option value="">Select payer</option>
                  {(refs?.payers ?? []).map((row) => <option key={row.id} value={row.id}>{text(row.name, "Payer")}</option>)}
                </select>
              </label>

              <label id="rejection-field-rendering_provider">
                Rendering provider
                <select className="thera-input" value={form.rendering_provider_id} onChange={(e) => field("rendering_provider_id", e.target.value)}>
                  <option value="">Select provider</option>
                  {(refs?.providers ?? []).map((row) => (
                    <option key={row.id} value={row.id}>
                      {personName(row)}{row.credentials ? `, ${String(row.credentials)}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label id="rejection-field-billing_provider">
                Billing provider
                <select className="thera-input" value={form.billing_provider_id} onChange={(e) => field("billing_provider_id", e.target.value)}>
                  <option value="">Select billing provider</option>
                  {(refs?.providers ?? []).map((row) => <option key={row.id} value={row.id}>{personName(row)}</option>)}
                </select>
              </label>

              <label id="rejection-field-patient_control_number">
                Patient control #
                <input className="thera-input" value={form.patient_control_number} onChange={(e) => field("patient_control_number", e.target.value)} />
              </label>

              <label id="rejection-field-payer_claim_number">
                Payer claim #
                <input className="thera-input" value={form.payer_claim_number} onChange={(e) => field("payer_claim_number", e.target.value)} />
              </label>

              <label id="rejection-field-service_date_from">
                DOS from
                <input className="thera-input" type="date" value={form.service_date_from} onChange={(e) => field("service_date_from", e.target.value)} />
              </label>

              <label id="rejection-field-service_date_to">
                DOS through
                <input className="thera-input" type="date" value={form.service_date_to} onChange={(e) => field("service_date_to", e.target.value)} />
              </label>

              <label id="rejection-field-total_charge_cents">
                Total charge
                <input
                  className="thera-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={(form.total_charge_cents / 100).toFixed(2)}
                  onChange={(e) => field("total_charge_cents", Math.round(Number(e.target.value || 0) * 100))}
                />
              </label>
            </div>
          </section>

          <section className="thera-card" id="rejection-field-claim-lines">
            <div className="thera-card-header">
              <div>
                <h2>Claim lines</h2>
                <p>CPT/HCPCS, modifiers, diagnosis pointer, POS, units, service date, and line charge can be corrected here.</p>
              </div>
            </div>

            <div className="thera-stack">
              {lines.map((line, index) => (
                <div className="thera-card" key={line.id}>
                  <strong>Line {index + 1}</strong>
                  <div className="thera-form-grid" style={{ marginTop: 10 }}>
                    <label>
                      DOS
                      <input id={`rejection-line-${index + 1}-service_date`} className="thera-input" type="date" value={line.service_date} onChange={(e) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, service_date: e.target.value } : row))} />
                    </label>
                    <label>
                      CPT / HCPCS
                      <input id={`rejection-line-${index + 1}-cpt_code`} className="thera-input" value={line.cpt_code} onChange={(e) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, cpt_code: e.target.value } : row))} />
                    </label>
                    <label>
                      Modifier 1
                      <input id={`rejection-line-${index + 1}-modifier1`} className="thera-input" value={line.modifier1} onChange={(e) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, modifier1: e.target.value } : row))} />
                    </label>
                    <label>
                      Modifier 2
                      <input id={`rejection-line-${index + 1}-modifier2`} className="thera-input" value={line.modifier2} onChange={(e) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, modifier2: e.target.value } : row))} />
                    </label>
                    <label>
                      Diagnosis pointer
                      <input id={`rejection-line-${index + 1}-diagnosis_pointer`} className="thera-input" value={line.diagnosis_pointer} onChange={(e) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, diagnosis_pointer: e.target.value } : row))} />
                    </label>
                    <label>
                      Place of service
                      <input id={`rejection-line-${index + 1}-place_of_service`} className="thera-input" value={line.place_of_service} onChange={(e) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, place_of_service: e.target.value } : row))} />
                    </label>
                    <label>
                      Units
                      <input id={`rejection-line-${index + 1}-units`} className="thera-input" type="number" min="0" step="1" value={line.units} onChange={(e) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, units: Number(e.target.value) } : row))} />
                    </label>
                    <label>
                      Charge
                      <input id={`rejection-line-${index + 1}-charge_amount_cents`} className="thera-input" type="number" min="0" step="0.01" value={(line.charge_amount_cents / 100).toFixed(2)} onChange={(e) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, charge_amount_cents: Math.round(Number(e.target.value || 0) * 100) } : row))} />
                    </label>
                  </div>
                </div>
              ))}
              {!lines.length ? <div className="thera-state">No claim lines are attached to this claim. Add a line below.</div> : null}
              <button type="button" className="thera-action secondary" onClick={() => setLines((current) => [...current, {
                id: "new:" + crypto.randomUUID(), service_date: form.service_date_from,
                cpt_code: "", modifier1: "", modifier2: "", diagnosis_pointer: "1",
                place_of_service: "11", units: 1, charge_amount_cents: 0,
              }])}>+ Add Service Line</button>
            </div>
          </section>

          <section className="thera-card" id="rejection-field-diagnoses">
            <div className="thera-card-header">
              <div>
                <h2>Diagnoses</h2>
                <p>ICD-10-CM lookup is connected directly to the rejection correction workflow.</p>
              </div>
            </div>

            <div className="thera-stack">
              {diagnoses.map((diagnosis, index) => (
                <div className="thera-card" key={diagnosis.id}>
                  <strong>Diagnosis {index + 1}</strong>
                  <div className="thera-form-grid" style={{ marginTop: 10 }}>
                    <Icd10SearchInput
                      code={diagnosis.diagnosis_code}
                      description=""
                      onSelect={(result) => setDiagnoses((current) => current.map((row) => row.id === diagnosis.id ? { ...row, diagnosis_code: result.code } : row))}
                    />
                    <label>
                      Pointer order
                      <input className="thera-input" type="number" min="1" value={diagnosis.pointer_order} onChange={(e) => setDiagnoses((current) => current.map((row) => row.id === diagnosis.id ? { ...row, pointer_order: Number(e.target.value) } : row))} />
                    </label>
                  </div>
                </div>
              ))}
              {!diagnoses.length ? <div className="thera-state">No diagnoses are attached to this claim. Add a diagnosis below.</div> : null}
              <button type="button" className="thera-action secondary" onClick={() => setDiagnoses((current) => [...current, {
                id: "new:" + crypto.randomUUID(), diagnosis_code: "", pointer_order: current.length + 1,
              }])}>+ Add Diagnosis</button>
            </div>
          </section>
        </div>
      )}
    </WorkDrawer>
  );
}
