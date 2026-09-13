import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import {
  addEncounterDiagnosis,
  addEncounterServiceLine,
  saveClinicalNote,
  signEncounterNote,
} from "../clinical/repository";
import { getEncounterDetail } from "./repository";

type EncounterDetail = Awaited<ReturnType<typeof getEncounterDetail>>;

function personName(row?: Record<string, any> | null) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function defaultPos(location?: string | null) {
  return location === "telehealth" || location === "phone" ? "02" : "11";
}

export function EncounterPage() {
  const [, params] = useRoute<{ id: string }>("/encounters/:id");
  const encounterId = params?.id ?? "";
  const [data, setData] = useState<EncounterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteType, setNoteType] = useState("psychotherapy");
  const [goalAddressed, setGoalAddressed] = useState("");
  const [diagnosisCode, setDiagnosisCode] = useState("");
  const [diagnosisDescription, setDiagnosisDescription] = useState("");
  const [serviceCode, setServiceCode] = useState("");
  const [modifier1, setModifier1] = useState("");
  const [units, setUnits] = useState(1);
  const [chargeDollars, setChargeDollars] = useState("");
  const [placeOfService, setPlaceOfService] = useState("11");
  const [signatureText, setSignatureText] = useState("");

  async function load() {
    if (!encounterId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getEncounterDetail(encounterId);
      setData(result);
      const note = result.notes[0];
      setNoteText(String(note?.note_text ?? ""));
      setNoteType(String(note?.note_type ?? "psychotherapy"));
      setGoalAddressed(String(note?.goal_addressed ?? ""));
      if (!serviceCode) {
        setServiceCode(String(result.appointment?.cpt_code ?? "90837"));
      }
      setPlaceOfService(defaultPos(String(result.encounter.location_type ?? "")));
      if (!signatureText && result.provider) {
        const providerName = personName(result.provider);
        const credentials = String(result.provider.credentials ?? "").trim();
        setSignatureText(`${providerName}${credentials ? `, ${credentials}` : ""}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load encounter.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [encounterId]);

  const signed = useMemo(
    () => Boolean(data?.notes.some((note) => ["signed", "locked"].includes(String(note.note_status)))),
    [data],
  );

  async function withSave(action: () => Promise<unknown>, successMessage: string) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(successMessage);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save encounter changes.");
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    await withSave(
      () => saveClinicalNote(encounterId, { noteType, noteText, goalAddressed }),
      "Clinical note saved and marked ready for signature.",
    );
  }

  async function addDiagnosis() {
    await withSave(
      () => addEncounterDiagnosis(encounterId, {
        diagnosisCode,
        diagnosisDescription,
        isPrimary: (data?.diagnoses.length ?? 0) === 0,
      }),
      "Diagnosis added to encounter.",
    );
    setDiagnosisCode("");
    setDiagnosisDescription("");
  }

  async function addServiceLine() {
    const amount = Math.round(Number(chargeDollars || 0) * 100);
    await withSave(
      () => addEncounterServiceLine(encounterId, {
        cptCode: serviceCode,
        modifier1,
        units,
        chargeAmountCents: amount,
        placeOfService,
      }),
      "Service line added to encounter.",
    );
    setModifier1("");
  }

  async function sign() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const providerId = String(data?.encounter.provider_id ?? "");
      const result = await signEncounterNote(encounterId, providerId, signatureText);
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage("Clinical note signed and locked. Billing readiness will now be evaluated.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign note.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <div className="thera-state">Loading encounter...</div>;
  if (error && !data) return <div className="thera-state error">{error}</div>;
  if (!data) return <div className="thera-state error">Encounter not found.</div>;

  const encounter = data.encounter;
  const note = data.notes[0];

  return (
    <>
      <div className="thera-breadcrumb">
        <Link href="/schedule" className="thera-link">Schedule</Link>
        <span>/</span>
        <Link href={`/clients/${String(encounter.client_id)}`} className="thera-link">{personName(data.client)}</Link>
        <span>/</span>
        <span>Encounter</span>
      </div>

      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">ENCOUNTER WORKSPACE</div>
          <h1>{personName(data.client)}</h1>
          <p>{personName(data.provider)} · {String(encounter.service_type ?? "Clinical Service")} · Started {dateTime(String(encounter.started_at ?? ""))}</p>
        </div>
        <div className="thera-header-badges">
          <StatusBadge value={String(encounter.encounter_status ?? "in_progress")} />
          <StatusBadge value={String(encounter.billing_status ?? "not_ready")} />
        </div>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="thera-detail-grid">
        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Encounter Context</h2><p>Patient, payer, service and appointment context.</p></div></div>
          <div className="thera-definition-grid">
            <Field label="Patient" value={personName(data.client)} />
            <Field label="Provider" value={personName(data.provider)} />
            <Field label="Payer" value={String(data.payer?.name ?? "—")} />
            <Field label="Plan" value={String(data.plan?.name ?? "—")} />
            <Field label="Member ID" value={String(data.policy?.member_id ?? "—")} />
            <Field label="Location" value={String(encounter.location_type ?? "—").replaceAll("_", " ")} />
          </div>
        </section>

        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Treatment Plan Context</h2><p>Active goals remain visible beside documentation.</p></div></div>
          {data.treatmentPlans.length === 0 ? <div className="thera-empty">No treatment plan is linked for this patient.</div> : (
            <div className="thera-stack">
              {data.treatmentPlans.slice(0, 2).map((plan) => (
                <div className="thera-stack-item" key={plan.id}>
                  <div className="thera-row-between"><strong>{String(plan.plan_name ?? plan.plan_text ?? "Treatment Plan")}</strong><StatusBadge value={String(plan.status ?? "active")} /></div>
                  <div className="thera-muted">Effective {shortDate(String(plan.effective_date ?? ""))} · Review {shortDate(String(plan.review_due_date ?? ""))}</div>
                  {data.treatmentPlanGoals.filter((goal) => goal.treatment_plan_id === plan.id).map((goal) => <div key={goal.id} style={{ marginTop: 6 }}>{String(goal.goal_text ?? goal.description ?? "Goal")}</div>)}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header">
            <div><h2>Clinical Documentation</h2><p>Documentation is encounter-centered and locks after signature.</p></div>
            {note && <StatusBadge value={String(note.note_status)} />}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, marginBottom: 12 }}>
            <label><div className="thera-field-label">Note Type</div><select className="thera-input" value={noteType} disabled={signed} onChange={(e) => setNoteType(e.target.value)}><option value="psychotherapy">Psychotherapy</option><option value="assessment">Assessment</option><option value="intake">Intake</option><option value="crisis">Crisis</option><option value="case_management">Case Management</option><option value="medication_management">Medication Management</option><option value="other">Other</option></select></label>
            <label><div className="thera-field-label">Goal Addressed</div><input className="thera-input" value={goalAddressed} disabled={signed} onChange={(e) => setGoalAddressed(e.target.value)} placeholder="Goal or objective addressed" /></label>
          </div>
          <label><div className="thera-field-label">Session / SOAP Note</div><textarea className="thera-input" style={{ minHeight: 180, resize: "vertical" }} value={noteText} disabled={signed} onChange={(e) => setNoteText(e.target.value)} placeholder="Document subjective/objective findings, assessment, interventions, response, plan, risk, and relevant clinical context." /></label>
          {!signed && <div style={{ marginTop: 12 }}><button type="button" className="thera-action" disabled={saving || !noteText.trim()} onClick={() => void saveNote()}>{saving ? "Saving..." : "Save Note"}</button></div>}
          {signed && data.signatures[0] && <div className="thera-alert" style={{ marginTop: 12 }}>Signed {dateTime(String(data.signatures[0].signed_at ?? ""))} by {String(data.signatures[0].signature_text ?? "provider")}</div>}
        </section>

        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Diagnoses</h2><p>Claim diagnoses originate from the encounter.</p></div></div>
          {data.diagnoses.length > 0 && <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Code</th><th>Description</th><th>Order</th><th>Primary</th></tr></thead><tbody>{data.diagnoses.map((diagnosis) => <tr key={diagnosis.id}><td><strong>{String(diagnosis.diagnosis_code)}</strong></td><td>{String(diagnosis.diagnosis_description ?? "—")}</td><td>{String(diagnosis.sequence_number)}</td><td>{diagnosis.is_primary ? "Yes" : "No"}</td></tr>)}</tbody></table></div>}
          {!signed && <div style={{ display: "grid", gap: 8, marginTop: 12 }}><input className="thera-input" placeholder="ICD-10 code" value={diagnosisCode} onChange={(e) => setDiagnosisCode(e.target.value)} /><input className="thera-input" placeholder="Description" value={diagnosisDescription} onChange={(e) => setDiagnosisDescription(e.target.value)} /><button type="button" className="thera-action secondary" disabled={saving || !diagnosisCode.trim()} onClick={() => void addDiagnosis()}>+ Add Diagnosis</button></div>}
        </section>

        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Service Lines</h2><p>CPT/HCPCS, units, POS and charge flow to billing.</p></div></div>
          {data.serviceLines.length > 0 && <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Code</th><th>Modifier</th><th>Units</th><th>POS</th><th>Charge</th></tr></thead><tbody>{data.serviceLines.map((line) => <tr key={line.id}><td><strong>{String(line.cpt_hcpcs_code)}</strong></td><td>{String(line.modifier1 ?? "—")}</td><td>{String(line.units)}</td><td>{String(line.place_of_service_code ?? "—")}</td><td>{money(Number(line.charge_amount_cents ?? 0))}</td></tr>)}</tbody></table></div>}
          {!signed && <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 12 }}><input className="thera-input" placeholder="CPT / HCPCS" value={serviceCode} onChange={(e) => setServiceCode(e.target.value)} /><input className="thera-input" placeholder="Modifier" value={modifier1} onChange={(e) => setModifier1(e.target.value)} /><input className="thera-input" type="number" min={1} placeholder="Units" value={units} onChange={(e) => setUnits(Number(e.target.value))} /><input className="thera-input" placeholder="POS" value={placeOfService} onChange={(e) => setPlaceOfService(e.target.value)} /><input className="thera-input" type="number" step="0.01" min="0" placeholder="Charge $" value={chargeDollars} onChange={(e) => setChargeDollars(e.target.value)} /><button type="button" className="thera-action secondary" disabled={saving || !serviceCode.trim()} onClick={() => void addServiceLine()}>+ Add Service Line</button></div>}
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header"><div><h2>Signature & Billing Handoff</h2><p>Signing locks the clinical note, completes the encounter, and triggers the billing-readiness workflow.</p></div></div>
          {signed ? <div className="thera-alert">Documentation is signed. The encounter is ready for the billing-readiness audit.</div> : <><label><div className="thera-field-label">Signature</div><input className="thera-input" value={signatureText} onChange={(e) => setSignatureText(e.target.value)} placeholder="Provider signature" /></label><div style={{ marginTop: 12 }}><button type="button" className="thera-action" disabled={saving || !noteText.trim() || !signatureText.trim()} onClick={() => void sign()}>{saving ? "Signing..." : "Sign & Lock Note"}</button></div></>}
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header"><div><h2>Billing Readiness</h2><p>Clinical and payer checks determine whether this encounter can become a charge.</p></div><StatusBadge value={String(encounter.billing_status ?? "not_ready")} /></div>
          {data.readinessChecks.length === 0 ? <div className="thera-empty">The full billing-readiness audit will run after documentation is signed.</div> : <div className="thera-stack">{data.readinessChecks.map((check) => <div className="thera-work-card" key={check.id}><div className="thera-work-card-top"><strong>{String(check.check_code).replaceAll("_", " ")}</strong><StatusBadge value={String(check.check_status)} /></div><div>{String(check.message)}</div>{check.action && <div className="thera-muted">Next action: {String(check.action)}</div>}</div>)}</div>}
        </section>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="thera-field-label">{label}</div><div className="thera-field-value">{value}</div></div>;
}
