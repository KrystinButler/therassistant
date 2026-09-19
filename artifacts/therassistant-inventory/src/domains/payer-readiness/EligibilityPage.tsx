import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { WorkDrawer } from "../../components/work-drawer";
import { money, shortDate } from "../../lib/format";
import {
  recordManualEligibility,
  runPatientEligibility,
  type ManualEligibilityInput,
  type ManualEligibilityStatus,
} from "../eligibility/repository";
import { getEligibilityQueueData } from "./repository";

type EligibilityRow = Awaited<ReturnType<typeof getEligibilityQueueData>>[number];

type ManualForm = {
  serviceDate: string;
  status: ManualEligibilityStatus;
  source: ManualEligibilityInput["source"];
  reference: string;
  copay: string;
  coinsurance: string;
  deductible: string;
  deductibleRemaining: string;
  outOfPocket: string;
  outOfPocketRemaining: string;
  networkStatus: "in_network" | "out_of_network" | "unknown";
  authorizationRequired: "" | "yes" | "no";
  notes: string;
};

const statusOptions: ManualEligibilityStatus[] = [
  "active",
  "eligible",
  "inactive",
  "ineligible",
  "coverage_terminated",
  "unable_to_verify",
  "pending",
  "error",
];

const sourceOptions: Array<[ManualEligibilityInput["source"], string]> = [
  ["payer_portal", "Payer Portal"],
  ["payer_phone", "Payer Phone"],
  ["clearinghouse_portal", "Clearinghouse Portal"],
  ["other", "Other"],
];

function blankManualForm(): ManualForm {
  return {
    serviceDate: new Date().toISOString().slice(0, 10),
    status: "active",
    source: "payer_portal",
    reference: "",
    copay: "",
    coinsurance: "",
    deductible: "",
    deductibleRemaining: "",
    outOfPocket: "",
    outOfPocketRemaining: "",
    networkStatus: "unknown",
    authorizationRequired: "",
    notes: "",
  };
}

function cents(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("Benefit dollar amounts must be zero or greater.");
  return Math.round(number * 100);
}

function percent(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new Error("Coinsurance must be between 0 and 100.");
  }
  return number;
}

function sourceLabel(value: string | null) {
  if (!value) return "Not checked";
  if (value === "synthetic_demo_270_271") return "Demo 270/271";
  if (value.startsWith("manual_")) {
    return `Manual · ${value.replace("manual_", "").replaceAll("_", " ")}`;
  }
  return value.replaceAll("_", " ");
}

export function EligibilityPage() {
  const [, navigate] = useLocation();
  const [rows, setRows] = useState<EligibilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [activeRow, setActiveRow] = useState<EligibilityRow | null>(null);
  const [manualForm, setManualForm] = useState<ManualForm>(blankManualForm());
  const [savingManual, setSavingManual] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await getEligibilityQueueData());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load eligibility queue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(
    () => (attentionOnly ? rows.filter((row) => row.needsAttention) : rows),
    [rows, attentionOnly],
  );
  const attentionCount = rows.filter((row) => row.needsAttention).length;
  const activeIndex = activeRow ? visible.findIndex((row) => row.id === activeRow.id) : -1;

  async function runDemo(row: EligibilityRow) {
    if (!row.policyId || !row.payerId || !row.memberId) return;
    setRunningId(row.id);
    setError(null);
    setMessage(null);
    try {
      await runPatientEligibility({
        patientId: row.patientId,
        policyId: row.policyId,
        payerId: row.payerId,
        memberId: row.memberId,
        serviceDate: new Date().toISOString().slice(0, 10),
      });
      setMessage("Demo 270/271 response saved. This is synthetic test data.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run demo eligibility.");
    } finally {
      setRunningId(null);
    }
  }

  function openManual(row: EligibilityRow) {
    if (!row.policyId || !row.payerId) {
      setError("Add an active insurance policy before recording eligibility.");
      return;
    }
    setError(null);
    setMessage(null);
    setActiveRow(row);
    setManualForm(blankManualForm());
  }

  function closeManual() {
    setActiveRow(null);
    setManualForm(blankManualForm());
  }

  function openAt(index: number) {
    const row = visible[index];
    if (row) openManual(row);
  }

  async function saveManual() {
    if (!activeRow?.policyId || !activeRow.payerId) return;
    setSavingManual(true);
    setError(null);
    setMessage(null);
    try {
      await recordManualEligibility({
        patientId: activeRow.patientId,
        policyId: activeRow.policyId,
        payerId: activeRow.payerId,
        serviceDate: manualForm.serviceDate,
        status: manualForm.status,
        source: manualForm.source,
        reference: manualForm.reference,
        copayCents: cents(manualForm.copay),
        coinsurancePercent: percent(manualForm.coinsurance),
        deductibleCents: cents(manualForm.deductible),
        deductibleRemainingCents: cents(manualForm.deductibleRemaining),
        outOfPocketCents: cents(manualForm.outOfPocket),
        outOfPocketRemainingCents: cents(manualForm.outOfPocketRemaining),
        networkStatus: manualForm.networkStatus,
        authorizationRequired:
          manualForm.authorizationRequired === ""
            ? null
            : manualForm.authorizationRequired === "yes",
        notes: manualForm.notes,
      });
      closeManual();
      setMessage("Manual eligibility verification saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save manual eligibility verification.");
    } finally {
      setSavingManual(false);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">PAYER READINESS</div>
          <h1>Eligibility</h1>
          <p>Verify coverage, record payer-confirmed benefits, and distinguish real manual checks from synthetic demo transactions.</p>
        </div>
        <button
          type="button"
          className={attentionOnly ? "thera-action" : "thera-action secondary"}
          onClick={() => setAttentionOnly((value) => !value)}
        >
          {attentionOnly ? "Show All" : `Needs Attention (${attentionCount})`}
        </button>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      {loading ? (
        <div className="thera-state">Loading eligibility queue...</div>
      ) : (
        <section className="thera-card">
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Payer</th>
                  <th>Member ID</th>
                  <th>Latest DOS</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td><Link className="thera-table-link" href={`/clients/${row.patientId}`}>{row.patientName}</Link></td>
                    <td>{row.payerName}</td>
                    <td>{row.memberId || "—"}</td>
                    <td>{row.serviceDate ? shortDate(row.serviceDate) : "—"}</td>
                    <td>{sourceLabel(row.responseSource)}</td>
                    <td><StatusBadge value={row.status} /></td>
                    <td>
                      <div className="thera-filter-row">
                        <button
                          type="button"
                          className="thera-action"
                          disabled={!row.policyId || !row.payerId}
                          onClick={() => openManual(row)}
                        >
                          Manual Verify
                        </button>
                        <button
                          type="button"
                          className="thera-action secondary"
                          disabled={!row.policyId || !row.payerId || !row.memberId || runningId === row.id}
                          onClick={() => void runDemo(row)}
                        >
                          {runningId === row.id ? "Running..." : "Demo 270/271"}
                        </button>
                        <Link className="thera-link" href={`/clients/${row.patientId}`}>Patient Chart</Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={7}><div className="thera-empty">No eligibility records match this view.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeRow && (
        <WorkDrawer
          open={Boolean(activeRow)}
          onOpenChange={(open) => { if (!open) closeManual(); }}
          title="Manual Eligibility Verification"
          subtitle={`${activeRow.patientName} · ${activeRow.payerName}`}
          badges={<StatusBadge value={manualForm.status} />}
          queuePosition={activeIndex >= 0 ? `${activeIndex + 1} of ${visible.length}` : undefined}
          onPrevious={() => openAt(activeIndex - 1)}
          onNext={() => openAt(activeIndex + 1)}
          previousDisabled={activeIndex <= 0}
          nextDisabled={activeIndex < 0 || activeIndex >= visible.length - 1}
          openFullRecord={() => navigate(`/clients/${activeRow.patientId}`)}
          openFullRecordLabel="Open Patient 360"
          footer={
            <div className="thera-filter-row" style={{ justifyContent: "space-between", width: "100%" }}>
              <button type="button" className="thera-action secondary" onClick={closeManual}>Cancel</button>
              <button type="button" className="thera-action" disabled={savingManual || !manualForm.serviceDate} onClick={() => void saveManual()}>
                {savingManual ? "Saving..." : "Save Verification"}
              </button>
            </div>
          }
        >
          <div className="thera-stack">
            <section className="thera-card">
              <div className="thera-card-header"><div><h2>Verification</h2><p>Document the source and coverage result exactly as verified.</p></div></div>
              <div className="thera-form-grid">
                <Field label="Patient" value={activeRow.patientName} />
                <Field label="Member ID" value={activeRow.memberId || "—"} />
                <label className="thera-field">
                  <span className="thera-field-label">Service Date</span>
                  <input className="thera-input" type="date" value={manualForm.serviceDate} onChange={(e) => setManualForm({ ...manualForm, serviceDate: e.target.value })} />
                </label>
                <label className="thera-field">
                  <span className="thera-field-label">Coverage Status</span>
                  <select className="thera-input" value={manualForm.status} onChange={(e) => setManualForm({ ...manualForm, status: e.target.value as ManualEligibilityStatus })}>
                    {statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                  </select>
                </label>
                <label className="thera-field">
                  <span className="thera-field-label">Verification Source</span>
                  <select className="thera-input" value={manualForm.source} onChange={(e) => setManualForm({ ...manualForm, source: e.target.value as ManualEligibilityInput["source"] })}>
                    {sourceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="thera-field">
                  <span className="thera-field-label">Reference / Call ID</span>
                  <input className="thera-input" value={manualForm.reference} onChange={(e) => setManualForm({ ...manualForm, reference: e.target.value })} />
                </label>
              </div>
            </section>

            <section className="thera-card">
              <div className="thera-card-header"><div><h2>Benefits</h2><p>Leave values blank when the payer did not provide them.</p></div></div>
              <div className="thera-form-grid">
                <MoneyField label="Copay" value={manualForm.copay} onChange={(copay) => setManualForm({ ...manualForm, copay })} />
                <label className="thera-field">
                  <span className="thera-field-label">Coinsurance %</span>
                  <input className="thera-input" type="number" min={0} max={100} step="0.01" value={manualForm.coinsurance} onChange={(e) => setManualForm({ ...manualForm, coinsurance: e.target.value })} />
                </label>
                <MoneyField label="Deductible" value={manualForm.deductible} onChange={(deductible) => setManualForm({ ...manualForm, deductible })} />
                <MoneyField label="Deductible Remaining" value={manualForm.deductibleRemaining} onChange={(deductibleRemaining) => setManualForm({ ...manualForm, deductibleRemaining })} />
                <MoneyField label="OOP Maximum" value={manualForm.outOfPocket} onChange={(outOfPocket) => setManualForm({ ...manualForm, outOfPocket })} />
                <MoneyField label="OOP Remaining" value={manualForm.outOfPocketRemaining} onChange={(outOfPocketRemaining) => setManualForm({ ...manualForm, outOfPocketRemaining })} />
                <label className="thera-field">
                  <span className="thera-field-label">Network Status</span>
                  <select className="thera-input" value={manualForm.networkStatus} onChange={(e) => setManualForm({ ...manualForm, networkStatus: e.target.value as ManualForm["networkStatus"] })}>
                    <option value="unknown">Unknown</option>
                    <option value="in_network">In Network</option>
                    <option value="out_of_network">Out of Network</option>
                  </select>
                </label>
                <label className="thera-field">
                  <span className="thera-field-label">Authorization Required</span>
                  <select className="thera-input" value={manualForm.authorizationRequired} onChange={(e) => setManualForm({ ...manualForm, authorizationRequired: e.target.value as ManualForm["authorizationRequired"] })}>
                    <option value="">Not verified</option>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="thera-card">
              <label className="thera-field">
                <span className="thera-field-label">Verification Notes</span>
                <textarea className="thera-input" rows={5} value={manualForm.notes} onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })} placeholder="Representative, portal details, limitations, benefit notes, or follow-up needed." />
              </label>
              <div className="thera-alert" style={{ marginTop: 12 }}>
                Manual verification records the result you obtained. It does not represent an electronic 270/271 transaction.
              </div>
            </section>
          </div>
        </WorkDrawer>
      )}
    </>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="thera-field">
      <span className="thera-field-label">{label}</span>
      <input className="thera-input" type="number" min={0} step="0.01" value={value} onChange={(e) => onChange(e.target.value)} placeholder={money(0)} />
    </label>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="thera-field"><span className="thera-field-label">{label}</span><div>{value}</div></div>;
}
