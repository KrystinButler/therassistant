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
import { buildPatientReviewCheckIn } from "../scheduling/patient-review-model";
import { treatmentPlanAlert } from "../treatment-plans/workflow";
import {
  appendClinicalSource,
  buildJournalNoteInsert,
  buildPreVisitNoteInsert,
  latestSharedJournalEntry,
} from "./clinical-source-context";
import { getEncounterDetail } from "./repository";
import "./encounter-page.css";

type EncounterDetail = Awaited<ReturnType<typeof getEncounterDetail>>;
type EncounterTab = "session" | "treatment" | "patient" | "attachments";

function personName(row?: Record<string, any> | null) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function defaultPos(location?: string | null) {
  return location === "telehealth" || location === "phone" ? "02" : "11";
}

function appointmentDuration(appointment?: Record<string, any> | null) {
  const start = new Date(String(appointment?.starts_at ?? "")).getTime();
  const end = new Date(String(appointment?.ends_at ?? "")).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function displayText(row: Record<string, any> | null | undefined, keys: string[], fallback = "—") {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

export function EncounterPage() {
  const [, params] = useRoute<{ id: string }>("/encounters/:id");
  const encounterId = params?.id ?? "";
  const [data, setData] = useState<EncounterDetail | null>(null);
  const [tab, setTab] = useState<EncounterTab>("session");
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
      setServiceCode((current) => current || String(result.appointment?.cpt_code ?? "90837"));
      setPlaceOfService(defaultPos(String(result.encounter.location_type ?? "")));
      setSignatureText((current) => {
        if (current || !result.provider) return current;
        const providerName = personName(result.provider);
        const credentials = String(result.provider.credentials ?? "").trim();
        return `${providerName}${credentials ? `, ${credentials}` : ""}`;
      });
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
      await saveClinicalNote(encounterId, { noteType, noteText, goalAddressed });
      const result = await signEncounterNote(encounterId, providerId, signatureText);
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage("Clinical note signed and locked. THERASSISTANT handed the encounter to Charge Capture; any billing exceptions remain outside the clinical workflow.");
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
  const currentTreatmentPlan = data.treatmentPlans.find((plan) =>
    ["active", "signed"].includes(String(plan.status ?? "")),
  ) ?? data.treatmentPlans[0] ?? null;
  const activeGoals = currentTreatmentPlan
    ? data.treatmentPlanGoals.filter((goal) => goal.treatment_plan_id === currentTreatmentPlan.id)
    : [];
  const activeGoal = activeGoals[0] ?? null;
  const treatmentPlanReadiness = currentTreatmentPlan
    ? treatmentPlanAlert(
        {
          status: String(currentTreatmentPlan.status ?? "draft"),
          reviewDueDate: currentTreatmentPlan.review_due_date
            ? String(currentTreatmentPlan.review_due_date)
            : null,
        },
        new Date(String(encounter.started_at ?? new Date().toISOString())),
      )
    : null;

  const currentCheckin = data.checkins.find(
    (row) => String(row.appointment_id ?? "") === String(encounter.appointment_id ?? ""),
  ) ?? null;
  const preVisit = buildPatientReviewCheckIn(currentCheckin);
  const preVisitInsert = buildPreVisitNoteInsert(preVisit);
  const sharedJournal = latestSharedJournalEntry(data.journalEntries);
  const journalInsert = buildJournalNoteInsert(sharedJournal);
  const duration = appointmentDuration(data.appointment);
  const activeGoalText = displayText(activeGoal, ["goal_text", "description", "goal", "title"], "");
  const visitFocus = preVisit.focus || goalAddressed || activeGoalText || "No patient focus was submitted for this visit.";

  const completionChecks = [
    {
      label: "Clinical note",
      status: noteText.trim() ? "pass" : "attention",
      detail: noteText.trim() ? "Documentation entered." : "Clinical documentation is still empty.",
    },
    {
      label: "Diagnosis",
      status: data.diagnoses.length ? "pass" : "attention",
      detail: data.diagnoses.length ? `${data.diagnoses.length} diagnosis record(s) connected.` : "No encounter diagnosis is saved yet.",
    },
    {
      label: "Coding / service",
      status: data.serviceLines.length ? "pass" : "attention",
      detail: data.serviceLines.length ? `${data.serviceLines.length} service line(s) connected.` : "No service line is saved yet.",
    },
    {
      label: "Documented time",
      status: duration > 0 ? "pass" : "attention",
      detail: duration > 0 ? `${duration} scheduled minutes available for review.` : "Visit duration is not available from the appointment.",
    },
  ] as const;
  const billingFollowUpCount = completionChecks.filter((check) => check.status !== "pass").length;

  function importPreVisit() {
    if (signed || !preVisitInsert) return;
    setNoteText((current) => appendClinicalSource(current, preVisitInsert));
    if (!goalAddressed.trim() && preVisit.treatmentGoal) {
      setGoalAddressed(preVisit.treatmentGoal);
    }
    setMessage("Patient-reported check-in content was inserted as labeled source material for provider review. It remains editable until signature.");
  }

  function importJournal() {
    if (signed || !journalInsert) return;
    setNoteText((current) => appendClinicalSource(current, journalInsert));
    setMessage("Patient-shared journal content was inserted as labeled source material for provider review. It remains editable until signature.");
  }

  return (
    <>
      <div className="thera-breadcrumb">
        <Link href="/schedule" className="thera-link">Schedule</Link>
        <span>/</span>
        <Link href={`/clients/${String(encounter.client_id)}`} className="thera-link">{personName(data.client)}</Link>
        <span>/</span>
        <span>Encounter</span>
      </div>

      <div className="thera-page-header split encounter-page-header">
        <div>
          <div className="thera-eyebrow">DOCUMENT · LIVE ENCOUNTER</div>
          <h1>{personName(data.client)}</h1>
          <p>{personName(data.provider)} · {String(encounter.service_type ?? "Clinical Service")} · Started {dateTime(String(encounter.started_at ?? ""))}</p>
        </div>
        <div className="thera-header-badges">
          <StatusBadge value={String(encounter.encounter_status ?? "in_progress")} />
          <StatusBadge value={String(encounter.billing_status ?? "not_ready")} />
        </div>
      </div>

      <section className="encounter-focus-banner">
        <div>
          <div className="thera-eyebrow">TODAY&apos;S FOCUS</div>
          <strong>{visitFocus}</strong>
          <span>{preVisit.hasSubmittedPreVisit ? "Patient-reported focus from pre-visit check-in" : activeGoalText ? "Active treatment-plan context" : "Provider-defined visit context"}</span>
        </div>
        <div className="encounter-focus-goal">
          <span>Active Goal</span>
          <strong>{activeGoalText || "No active goal documented"}</strong>
        </div>
      </section>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="thera-tabs encounter-tabs" role="tablist" aria-label="Encounter workspace">
        <Tab active={tab === "session"} label="Session & Note" onClick={() => setTab("session")} />
        <Tab active={tab === "treatment"} label="Treatment Plan" onClick={() => setTab("treatment")} />
        <Tab active={tab === "patient"} label="Patient Info" onClick={() => setTab("patient")} />
        <Tab active={tab === "attachments"} label={`Attachments (${data.documents.length})`} onClick={() => setTab("attachments")} />
      </div>

      {tab === "session" && (
        <div className="encounter-workspace">
          <section className="thera-card encounter-note-card">
            <div className="thera-card-header">
              <div>
                <div className="thera-eyebrow">DOCUMENT</div>
                <h2>Active Progress Note</h2>
                <p>Patient-submitted information stays labeled until you deliberately import, review, edit, or remove it.</p>
              </div>
              {note && <StatusBadge value={String(note.note_status)} />}
            </div>

            <div className="encounter-note-controls">
              <label>
                <div className="thera-field-label">Note Type</div>
                <select className="thera-input" value={noteType} disabled={signed} onChange={(e) => setNoteType(e.target.value)}>
                  <option value="psychotherapy">Psychotherapy</option>
                  <option value="assessment">Assessment</option>
                  <option value="intake">Intake</option>
                  <option value="crisis">Crisis</option>
                  <option value="case_management">Case Management</option>
                  <option value="medication_management">Medication Management</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                <div className="thera-field-label">Goal / Objective Addressed</div>
                <input className="thera-input" value={goalAddressed} disabled={signed} onChange={(e) => setGoalAddressed(e.target.value)} placeholder="Goal or objective addressed" />
              </label>
            </div>

            <label>
              <div className="thera-field-label">Session / SOAP Note</div>
              <textarea
                className="thera-input encounter-note-editor"
                value={noteText}
                disabled={signed}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Document subjective/objective findings, assessment, interventions, response, plan, risk, and relevant clinical context."
              />
            </label>

            {!signed && (
              <div className="encounter-note-actions">
                <button type="button" className="thera-action" disabled={saving || !noteText.trim()} onClick={() => void saveNote()}>
                  {saving ? "Saving..." : "Save Note"}
                </button>
                <span>Saving does not sign or lock the clinical record.</span>
              </div>
            )}
            {signed && data.signatures[0] && (
              <div className="thera-alert" style={{ marginTop: 12 }}>
                Signed {dateTime(String(data.signatures[0].signed_at ?? ""))} by {String(data.signatures[0].signature_text ?? "provider")}
              </div>
            )}
          </section>

          <aside className="thera-card encounter-source-card">
            <div className="thera-card-header">
              <div>
                <div className="thera-eyebrow">PATIENT-SUBMITTED CONTEXT</div>
                <h2>Session Sources</h2>
                <p>Review source material without silently converting it into provider-authored documentation.</p>
              </div>
            </div>

            <div className="encounter-source-block">
              <div className="thera-row-between">
                <strong>Pre-Visit Check-In</strong>
                <StatusBadge value={preVisit.hasSubmittedPreVisit ? "submitted" : "not_submitted"} />
              </div>
              {preVisit.hasSubmittedPreVisit ? (
                <div className="thera-stack">
                  {preVisit.focus && <Field label="Focus Today" value={preVisit.focus} />}
                  {preVisit.mood && <Field label="Since Last Visit" value={preVisit.mood} />}
                  {preVisit.changes.length > 0 && <Field label="Important Changes" value={preVisit.changes.join("; ")} />}
                  {preVisit.safetyText && <Field label="Safety Response" value={preVisit.safetyText} />}
                  {preVisit.additionalContext && <Field label="Additional Context" value={preVisit.additionalContext} />}
                  {!signed && preVisitInsert && <button type="button" className="thera-action secondary" onClick={importPreVisit}>Import Check-In</button>}
                </div>
              ) : <div className="thera-muted">No submitted pre-visit check-in for this appointment.</div>}
            </div>

            <div className="encounter-source-block">
              <div className="thera-row-between">
                <strong>Session Journal</strong>
                <StatusBadge value={sharedJournal ? "shared_with_provider" : "none_shared"} />
              </div>
              {sharedJournal ? (
                <div className="thera-stack">
                  <Field label="Entry Date" value={shortDate(String(sharedJournal.entry_date ?? sharedJournal.created_at ?? ""))} />
                  <div className="encounter-journal-preview">{String(sharedJournal.entry_text ?? "")}</div>
                  {!signed && journalInsert && <button type="button" className="thera-action secondary" onClick={importJournal}>Import Session Journal</button>}
                </div>
              ) : <div className="thera-muted">No submitted journal entry is shared with the provider.</div>}
            </div>
          </aside>

          <section className="thera-card">
            <div className="thera-card-header">
              <div>
                <div className="thera-eyebrow">CLINICAL CONTEXT</div>
                <h2>Diagnoses</h2>
                <p>Diagnoses remain connected to this encounter and flow to claim creation.</p>
              </div>
            </div>
            {data.diagnoses.length > 0 && (
              <div className="thera-table-wrap">
                <table className="thera-table">
                  <thead><tr><th>Code</th><th>Description</th><th>Primary</th></tr></thead>
                  <tbody>{data.diagnoses.map((diagnosis) => (
                    <tr key={diagnosis.id}>
                      <td><strong>{String(diagnosis.diagnosis_code)}</strong></td>
                      <td>{String(diagnosis.diagnosis_description ?? "—")}</td>
                      <td>{diagnosis.is_primary ? "Yes" : "No"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <div className="encounter-compact-form">
              <input className="thera-input" placeholder="ICD-10 code" value={diagnosisCode} onChange={(e) => setDiagnosisCode(e.target.value)} />
              <input className="thera-input" placeholder="Description" value={diagnosisDescription} onChange={(e) => setDiagnosisDescription(e.target.value)} />
              <button type="button" className="thera-action secondary" disabled={saving || !diagnosisCode.trim()} onClick={() => void addDiagnosis()}>+ Add Diagnosis</button>
            </div>
          </section>

          <section className="thera-card">
            <div className="thera-card-header">
              <div>
                <div className="thera-eyebrow">CODE</div>
                <h2>Coding & Service</h2>
                <p>Confirm the service, units, documented time, place of service, modifier, and charge before revenue-cycle handoff.</p>
              </div>
            </div>

            <div className="encounter-coding-summary">
              <Field label="Scheduled Time" value={duration ? `${duration} minutes` : "Not available"} />
              <Field label="Visit Location" value={String(encounter.location_type ?? "—").replaceAll("_", " ")} />
              <Field label="Current POS" value={placeOfService || "—"} />
              <Field label="Payer" value={String(data.payer?.name ?? "—")} />
            </div>

            {data.serviceLines.length > 0 && (
              <div className="thera-table-wrap">
                <table className="thera-table">
                  <thead><tr><th>Code</th><th>Modifier</th><th>Units</th><th>POS</th><th>Charge</th></tr></thead>
                  <tbody>{data.serviceLines.map((line) => (
                    <tr key={line.id}>
                      <td><strong>{String(line.cpt_hcpcs_code)}</strong></td>
                      <td>{String(line.modifier1 ?? "—")}</td>
                      <td>{String(line.units)}</td>
                      <td>{String(line.place_of_service_code ?? "—")}</td>
                      <td>{money(Number(line.charge_amount_cents ?? 0))}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            <div className="encounter-service-form">
              <input className="thera-input" placeholder="CPT / HCPCS" value={serviceCode} onChange={(e) => setServiceCode(e.target.value)} />
              <input className="thera-input" placeholder="Modifier" value={modifier1} onChange={(e) => setModifier1(e.target.value)} />
              <input className="thera-input" type="number" min={1} placeholder="Units" value={units} onChange={(e) => setUnits(Number(e.target.value))} />
              <input className="thera-input" placeholder="POS" value={placeOfService} onChange={(e) => setPlaceOfService(e.target.value)} />
              <input className="thera-input" type="number" step="0.01" min="0" placeholder="Charge $" value={chargeDollars} onChange={(e) => setChargeDollars(e.target.value)} />
              <button type="button" className="thera-action secondary" disabled={saving || !serviceCode.trim()} onClick={() => void addServiceLine()}>+ Add Service Line</button>
            </div>
          </section>

          <section className="thera-card thera-span-2 encounter-sign-card">
            <div className="thera-card-header">
              <div>
                <div className="thera-eyebrow">REVIEW → SIGN</div>
                <h2>Documentation Readiness & Signature</h2>
                <p>Review what is complete before signature. Billing follow-up never prevents the provider from completing the clinical record.</p>
              </div>
              <StatusBadge value={billingFollowUpCount ? "billing_follow_up" : "ready"} />
            </div>

            <div className="encounter-readiness-grid">
              {completionChecks.map((check) => (
                <div className="encounter-readiness-item" key={check.label}>
                  <StatusBadge value={check.status} />
                  <div><strong>{check.label}</strong><span>{check.detail}</span></div>
                </div>
              ))}
            </div>

            <div className="encounter-nonblocking-note">
              {billingFollowUpCount
                ? `${billingFollowUpCount} item(s) still need billing/coding follow-up. You may still sign the clinical note; THERASSISTANT will keep those issues in billing readiness instead of blocking care.`
                : "The clinical record and current billing details are ready for handoff."}
            </div>

            {signed ? (
              <div className="encounter-signed-handoff">
                <div>
                  <strong>Signed clinical record → Charge Capture</strong>
                  <span>The note is locked. Billing/coding corrections can continue without changing the signed provider documentation.</span>
                </div>
                <Link href="/billing/charges" className="thera-action">Open Charge Capture</Link>
              </div>
            ) : (
              <div className="encounter-sign-row">
                <label>
                  <div className="thera-field-label">Provider Signature</div>
                  <input className="thera-input" value={signatureText} onChange={(e) => setSignatureText(e.target.value)} placeholder="Provider signature" />
                </label>
                <button type="button" className="thera-action" disabled={saving || !noteText.trim() || !signatureText.trim()} onClick={() => void sign()}>
                  {saving ? "Signing..." : "Sign & Lock Note"}
                </button>
              </div>
            )}
          </section>

          {signed && (
            <section className="thera-card thera-span-2">
              <div className="thera-card-header">
                <div>
                  <div className="thera-eyebrow">GET PAID · HANDOFF</div>
                  <h2>Billing Readiness</h2>
                  <p>After signature, the revenue-cycle workflow owns unresolved billing requirements.</p>
                </div>
                <StatusBadge value={String(encounter.billing_status ?? "not_ready")} />
              </div>
              {data.readinessChecks.length === 0 ? (
                <div className="thera-empty">No billing-readiness exceptions are currently recorded.</div>
              ) : (
                <div className="thera-stack">
                  {data.readinessChecks.map((check) => (
                    <div className="thera-work-card" key={check.id}>
                      <div className="thera-work-card-top">
                        <strong>{String(check.check_code).replaceAll("_", " ")}</strong>
                        <StatusBadge value={String(check.check_status)} />
                      </div>
                      <div>{String(check.message)}</div>
                      {check.action && <div className="thera-muted">Next action: {String(check.action)}</div>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {tab === "treatment" && (
        <div className="encounter-workspace">
          <section className="thera-card thera-span-2">
            <div className="thera-card-header">
              <div>
                <div className="thera-eyebrow">GOLDEN THREAD</div>
                <h2>Treatment Plan & Active Goals</h2>
                <p>Keep the session connected to diagnosis, goals, objectives, intervention, response, progress, and medical necessity.</p>
              </div>
              {treatmentPlanReadiness && <StatusBadge value={treatmentPlanReadiness.code} />}
            </div>
            {data.treatmentPlans.length === 0 ? (
              <div className="thera-empty">No treatment plan is linked for this patient. Clinical care can continue while plan work remains visible.</div>
            ) : (
              <div className="thera-stack">
                {treatmentPlanReadiness && <div className="thera-alert">{treatmentPlanReadiness.message}</div>}
                {data.treatmentPlans.map((plan) => (
                  <div className="encounter-plan-card" key={plan.id}>
                    <div className="thera-row-between">
                      <div>
                        <strong>{String(plan.plan_name ?? plan.plan_text ?? "Treatment Plan")}</strong>
                        <div className="thera-muted">Effective {shortDate(String(plan.effective_date ?? ""))} · Review {shortDate(String(plan.review_due_date ?? ""))}</div>
                      </div>
                      <StatusBadge value={String(plan.status ?? "active")} />
                    </div>
                    <div className="encounter-goal-list">
                      {data.treatmentPlanGoals.filter((goal) => goal.treatment_plan_id === plan.id).map((goal) => (
                        <div key={goal.id}>
                          <span>Goal</span>
                          <strong>{String(goal.goal_text ?? goal.description ?? "Goal")}</strong>
                          <small>{String(goal.goal_status ?? goal.status ?? "active").replaceAll("_", " ")}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "patient" && (
        <div className="encounter-workspace">
          <section className="thera-card">
            <div className="thera-card-header">
              <div><div className="thera-eyebrow">PATIENT INFO</div><h2>Patient & Visit</h2><p>Core chart context remains one tab away from the active note.</p></div>
            </div>
            <div className="thera-definition-grid">
              <Field label="Patient" value={personName(data.client)} />
              <Field label="DOB" value={shortDate(String(data.client?.date_of_birth ?? ""))} />
              <Field label="Phone" value={String(data.client?.phone ?? "—")} />
              <Field label="Email" value={String(data.client?.email ?? "—")} />
              <Field label="Provider" value={personName(data.provider)} />
              <Field label="Service" value={String(encounter.service_type ?? data.appointment?.service_type ?? "—")} />
            </div>
            <div style={{ marginTop: 14 }}>
              <Link href={`/clients/${String(encounter.client_id)}`} className="thera-action secondary">Open Full Patient Chart</Link>
            </div>
          </section>

          <section className="thera-card">
            <div className="thera-card-header">
              <div><div className="thera-eyebrow">COVERAGE CONTEXT</div><h2>Payer & Appointment</h2><p>Coverage stays visible without turning the provider encounter into a billing dashboard.</p></div>
            </div>
            <div className="thera-definition-grid">
              <Field label="Payer" value={String(data.payer?.name ?? "—")} />
              <Field label="Plan" value={String(data.plan?.name ?? "—")} />
              <Field label="Member ID" value={String(data.policy?.member_id ?? "—")} />
              <Field label="Location" value={String(encounter.location_type ?? "—").replaceAll("_", " ")} />
              <Field label="Appointment" value={data.appointment?.starts_at ? dateTime(String(data.appointment.starts_at)) : "—"} />
              <Field label="Duration" value={duration ? `${duration} minutes` : "—"} />
            </div>
          </section>
        </div>
      )}

      {tab === "attachments" && (
        <section className="thera-card">
          <div className="thera-card-header split">
            <div>
              <div className="thera-eyebrow">ENCOUNTER CONTEXT</div>
              <h2>Attachments & Chart Documents</h2>
              <p>Clinical forms, prior records, payer correspondence, and other patient documents stay linked to the chart.</p>
            </div>
            <Link href={`/clients/${String(encounter.client_id)}`} className="thera-action secondary">Manage in Patient Chart</Link>
          </div>
          {data.documents.length ? (
            <div className="thera-table-wrap">
              <table className="thera-table">
                <thead><tr><th>Created</th><th>Type</th><th>File Name</th><th>Status</th></tr></thead>
                <tbody>{data.documents.map((document) => (
                  <tr key={document.id}>
                    <td>{dateTime(String(document.created_at ?? ""))}</td>
                    <td>{String(document.document_type ?? "other").replaceAll("_", " ")}</td>
                    <td>{String(document.file_name ?? "—")}</td>
                    <td><StatusBadge value={String(document.document_status ?? "uploaded")} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="thera-empty">No patient documents are indexed.</div>}
        </section>
      )}
    </>
  );
}

function Tab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} className={active ? "thera-tab active" : "thera-tab"} onClick={onClick}>{label}</button>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="thera-field-label">{label}</div><div className="thera-field-value">{value}</div></div>;
}
