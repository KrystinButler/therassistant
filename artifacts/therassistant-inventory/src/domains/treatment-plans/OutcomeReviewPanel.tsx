import { useEffect, useMemo, useState } from "react";

import type { PatientChart } from "../patients/types";
import {
  create90DayReview,
  getOutcomeWorkspace,
  getReviewSignatureReadiness,
  linkCurrentUserToProvider,
  recordOutcome,
  signTreatmentPlanReview,
  updateReviewDraft,
  type ReviewSignatureReadiness,
} from "./outcome-review-repository";
import {
  maxScore,
  outcomeTrend,
  type Instrument,
  type Measure,
  type Plan,
  type Visit,
} from "./outcome-review-model";

type Data = Awaited<ReturnType<typeof getOutcomeWorkspace>>;
type DataRow = Record<string, unknown> & { id: string };

const ATTESTATION =
  "I attest that I reviewed and edited this treatment plan review and that it accurately reflects my clinical assessment as of the review date.";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to save clinical outcome data.";
}

function fmt(value: unknown) {
  return String(value ?? "");
}

function readinessMessage(readiness: ReviewSignatureReadiness | null) {
  if (!readiness) return "Select a review draft to check signature readiness.";
  if (readiness.signed || readiness.reason === "already_signed") return "This review is signed and immutable.";
  if (readiness.reason === "provider_required") return "Assign a responsible provider to the source treatment plan before signing.";
  if (readiness.reason === "clinician_role_required") return "The signed-in account must have the Clinician role for this practice.";
  if (readiness.reason === "email_mismatch") return "The clinician login email must match the responsible provider email before the accounts can be linked.";
  if (readiness.reason === "provider_not_linked") return "Link this clinician login to the responsible provider before signing.";
  if (readiness.can_sign) return "Clinician identity and responsible-provider linkage are verified.";
  return "This review is not ready for signature.";
}

export function OutcomeReviewPanel({ chart }: { chart: PatientChart }) {
  const patientId = chart.patient.id;
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [instrument, setInstrument] = useState<Instrument>("PHQ-9");
  const [score, setScore] = useState("");
  const [assessedOn, setAssessedOn] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState<"clinician_entered" | "patient_reported">("clinician_entered");
  const [planId, setPlanId] = useState("");
  const [reviewDate, setReviewDate] = useState(new Date().toISOString().slice(0, 10));
  const [draftId, setDraftId] = useState("");
  const [draftText, setDraftText] = useState("");
  const [readiness, setReadiness] = useState<ReviewSignatureReadiness | null>(null);
  const [signatureText, setSignatureText] = useState("");
  const [attestationAccepted, setAttestationAccepted] = useState(false);

  async function refresh() {
    try {
      const result = await getOutcomeWorkspace(patientId);
      setData(result);
      setError(null);
      return result;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [patientId]);

  const measures = useMemo(() => ((data?.measures ?? []) as unknown as Measure[]), [data]);
  const trends = useMemo(
    () =>
      ["PHQ-9", "GAD-7"].map((name) => ({
        instrument: name as Instrument,
        trend: outcomeTrend(measures, name as Instrument),
      })),
    [measures],
  );
  const eligiblePlans = chart.treatmentPlans.filter((plan) =>
    ["active", "signed", "under_review"].includes(fmt(plan.status)),
  );
  const selectedPlan = eligiblePlans.find((plan) => plan.id === planId) ?? eligiblePlans[0] ?? null;
  const selectedSignature =
    data?.signatures.find((row) => String(row.review_draft_id ?? "") === draftId) ?? null;

  useEffect(() => {
    if (!draftId) {
      setReadiness(null);
      return;
    }
    if (selectedSignature) {
      setReadiness({
        can_sign: false,
        reason: "already_signed",
        signed: true,
        signed_at: fmt(selectedSignature.signed_at),
        provider_id: fmt(selectedSignature.provider_id),
        provider_name: fmt(selectedSignature.provider_name_snapshot),
      });
      return;
    }

    let active = true;
    void getReviewSignatureReadiness(draftId)
      .then((result) => {
        if (active) setReadiness(result);
      })
      .catch((err) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [draftId, selectedSignature?.id]);

  async function saveMeasure() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      if (score.trim() === "" || !Number.isInteger(Number(score))) {
        throw new Error("Enter a whole-number score.");
      }
      await recordOutcome(patientId, { instrument, score: Number(score), assessedOn, source });
      setScore("");
      await refresh();
      setMessage(instrument + " assessment saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    if (!selectedPlan || !data) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const row = await create90DayReview(
        patientId,
        selectedPlan as unknown as Plan,
        measures,
        data.visits as Visit[],
        reviewDate,
      );
      setDraftId(row.id);
      setDraftText(fmt(row.draft_text));
      setSignatureText("");
      setAttestationAccepted(false);
      await refresh();
      setMessage("Editable review draft generated. The active treatment plan has not changed.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function openReview(row: DataRow) {
    const signature = data?.signatures.find(
      (item) => String(item.review_draft_id ?? "") === row.id,
    );
    setDraftId(row.id);
    setDraftText(signature ? fmt(signature.signed_text_snapshot) : fmt(row.draft_text));
    setSignatureText("");
    setAttestationAccepted(false);
    setMessage(null);
    setError(null);
  }

  async function saveDraft() {
    if (!draftId || selectedSignature) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateReviewDraft(draftId, draftText);
      await refresh();
      const next = await getReviewSignatureReadiness(draftId);
      setReadiness(next);
      setMessage("Review draft saved. Clinician signature is still required.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function linkClinicianAccount() {
    if (!draftId || !readiness?.provider_id) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await linkCurrentUserToProvider(readiness.provider_id);
      setReadiness(await getReviewSignatureReadiness(draftId));
      setMessage("Clinician login linked to " + result.provider_name + ".");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function signReview() {
    if (!draftId || selectedSignature) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateReviewDraft(draftId, draftText);
      const result = await signTreatmentPlanReview(
        draftId,
        signatureText,
        attestationAccepted,
      );
      await refresh();
      setSignatureText("");
      setAttestationAccepted(false);
      setReadiness({
        can_sign: false,
        reason: "already_signed",
        signed: true,
        signed_at: result.signed_at,
        provider_name: result.provider_name,
      });
      setMessage(
        "Treatment plan review signed and locked. The active treatment plan was not automatically replaced.",
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="thera-stack" style={{ marginTop: 20 }}>
      <div className="thera-card">
        <div className="thera-card-header">
          <div>
            <div className="thera-eyebrow">MEASUREMENT-BASED CARE</div>
            <h3>PHQ-9 and GAD-7</h3>
            <p>Enter dated assessment totals. The system displays numerical changes without diagnosing or interpreting treatment response.</p>
          </div>
        </div>
        {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
        {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}
        <div className="thera-form-grid">
          <label className="thera-field">
            <span className="thera-field-label">Instrument</span>
            <select className="thera-input" value={instrument} onChange={(e) => { setInstrument(e.target.value as Instrument); setScore(""); }}>
              <option>PHQ-9</option><option>GAD-7</option>
            </select>
          </label>
          <label className="thera-field">
            <span className="thera-field-label">Total Score (0–{maxScore(instrument)})</span>
            <input className="thera-input" type="number" min="0" max={maxScore(instrument)} step="1" value={score} onChange={(e) => setScore(e.target.value)} />
          </label>
          <label className="thera-field">
            <span className="thera-field-label">Assessment Date</span>
            <input className="thera-input" type="date" value={assessedOn} onChange={(e) => setAssessedOn(e.target.value)} />
          </label>
          <label className="thera-field">
            <span className="thera-field-label">Source</span>
            <select className="thera-input" value={source} onChange={(e) => setSource(e.target.value as "clinician_entered" | "patient_reported")}>
              <option value="clinician_entered">Clinician entered</option>
              <option value="patient_reported">Patient reported</option>
            </select>
          </label>
        </div>
        <div className="thera-filter-row" style={{ marginTop: 12 }}>
          <button type="button" className="thera-action" disabled={saving || score === "" || !assessedOn} onClick={() => void saveMeasure()}>Save Assessment</button>
        </div>

        {loading ? <div className="thera-state">Loading outcomes…</div> : <>
          <div className="thera-definition-grid" style={{ marginTop: 18 }}>
            {trends.map(({ instrument: name, trend }) => (
              <div key={name}>
                <div className="thera-field-label">{name}</div>
                <div className="thera-field-value">{trend ? String(trend.last.score) + " / " + maxScore(name) : "No assessments"}</div>
                <div className="thera-table-subtext">{trend ? (trend.count > 1 ? "Change " + (trend.delta > 0 ? "+" : "") + trend.delta : "One assessment recorded") : "No trend available"}</div>
              </div>
            ))}
          </div>
          {measures.length ? (
            <div className="thera-table-wrap" style={{ marginTop: 12 }}>
              <table className="thera-table">
                <thead><tr><th>Date</th><th>Instrument</th><th>Score</th><th>Source</th></tr></thead>
                <tbody>{measures.slice(0, 20).map((row) => (
                  <tr key={row.id}><td>{row.assessed_on}</td><td>{row.instrument}</td><td>{row.score} / {maxScore(row.instrument)}</td><td>{row.source === "patient_reported" ? "Patient reported" : "Clinician entered"}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="thera-empty">No outcome assessments recorded.</div>}
        </>}
      </div>

      <div className="thera-card">
        <div className="thera-card-header">
          <div>
            <div className="thera-eyebrow">CLINICAL CONTINUITY</div>
            <h3>90-Day Treatment Plan Review</h3>
            <p>Drafts use linked goals, recorded scores, and signed-visit dates. Signing creates an immutable clinician snapshot; it never replaces the active plan automatically.</p>
          </div>
        </div>

        <div className="thera-form-grid">
          <label className="thera-field">
            <span className="thera-field-label">Source Treatment Plan</span>
            <select className="thera-input" value={selectedPlan?.id ?? ""} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Select active plan</option>
              {eligiblePlans.map((plan) => <option key={plan.id} value={plan.id}>{fmt(plan.problem_statement) || "Plan"} · {fmt(plan.effective_date)}</option>)}
            </select>
          </label>
          <label className="thera-field">
            <span className="thera-field-label">Review Date</span>
            <input className="thera-input" type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
          </label>
        </div>

        {!eligiblePlans.length && <div className="thera-state">Create an active treatment plan first. Review generation does not block clinical work.</div>}
        <div className="thera-filter-row" style={{ marginTop: 12 }}>
          <button type="button" className="thera-action" disabled={saving || !data || !selectedPlan || !reviewDate} onClick={() => void generate()}>Generate Editable Review Draft</button>
        </div>

        {data?.reviews.length ? (
          <div style={{ marginTop: 16 }}>
            <div className="thera-field-label">Treatment Plan Reviews</div>
            <div className="thera-filter-row" style={{ flexWrap: "wrap" }}>
              {data.reviews.map((row) => {
                const signature = data.signatures.find((item) => String(item.review_draft_id ?? "") === row.id);
                return <button type="button" className="thera-action secondary" key={row.id} onClick={() => openReview(row)}>
                  {fmt(row.review_date)} · {signature ? "Signed" : "Draft"}
                </button>;
              })}
            </div>
          </div>
        ) : null}

        {draftId && (
          <div style={{ marginTop: 14 }}>
            <div className="thera-field-label">{selectedSignature ? "Signed Clinical Review — Locked" : "Editable Clinical Review Draft — Not Signed"}</div>
            <textarea
              className="thera-input"
              style={{ minHeight: 360, width: "100%" }}
              value={draftText}
              disabled={Boolean(selectedSignature)}
              onChange={(e) => setDraftText(e.target.value)}
            />

            {selectedSignature ? (
              <div className="thera-alert" style={{ marginTop: 10 }}>
                <strong>Signed by {fmt(selectedSignature.provider_name_snapshot)}</strong>
                {selectedSignature.provider_credentials_snapshot ? " · " + fmt(selectedSignature.provider_credentials_snapshot) : ""}
                <div>Signed {fmt(selectedSignature.signed_at)}</div>
                <div>Signature: {fmt(selectedSignature.signature_text)}</div>
                <div className="thera-table-subtext" style={{ marginTop: 4 }}>{fmt(selectedSignature.attestation_text)}</div>
              </div>
            ) : (
              <>
                <div className="thera-filter-row" style={{ marginTop: 10 }}>
                  <button type="button" className="thera-action secondary" disabled={saving || !draftText.trim()} onClick={() => void saveDraft()}>Save Review Draft</button>
                  <span className="thera-table-subtext">{readinessMessage(readiness)}</span>
                </div>

                {readiness?.reason === "provider_not_linked" && readiness.email_match && readiness.clinician_role && (
                  <div className="thera-alert" style={{ marginTop: 10 }}>
                    <strong>Identity match found.</strong> Your clinician login email matches {readiness.provider_name}. Link the account once to enable clinical signatures.
                    <div style={{ marginTop: 8 }}>
                      <button type="button" className="thera-action secondary" disabled={saving} onClick={() => void linkClinicianAccount()}>Link My Clinician Account</button>
                    </div>
                  </div>
                )}

                <div className="thera-card" style={{ marginTop: 12, padding: 12 }}>
                  <div className="thera-field-label">Clinician Signature</div>
                  <input
                    className="thera-input"
                    value={signatureText}
                    disabled={!readiness?.can_sign}
                    onChange={(e) => setSignatureText(e.target.value)}
                    placeholder="Type your full professional name"
                  />
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10 }}>
                    <input type="checkbox" checked={attestationAccepted} disabled={!readiness?.can_sign} onChange={(e) => setAttestationAccepted(e.target.checked)} />
                    <span>{ATTESTATION}</span>
                  </label>
                  <div className="thera-filter-row" style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="thera-action"
                      disabled={saving || !readiness?.can_sign || !signatureText.trim() || !attestationAccepted || draftText.includes("[CLINICIAN")}
                      onClick={() => void signReview()}
                    >
                      Sign & Lock Review
                    </button>
                    {draftText.includes("[CLINICIAN") && <span className="thera-table-subtext">Complete all [CLINICIAN…] prompts before signing.</span>}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
