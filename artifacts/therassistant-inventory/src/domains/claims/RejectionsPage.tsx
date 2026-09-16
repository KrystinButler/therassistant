import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { money, shortDate } from "../../lib/format";
import { demoInsert, demoUpdate } from "../../lib/supabase-demo-client";
import {
  getOperationalHome,
  getRejectionCategories,
  type RejectionCategory,
} from "../rcm/queue-routing";
import {
  getClaimErrorGuidance,
  type ClaimCorrectionTarget,
} from "./claim-error-guidance";
import { ClaimWorkDrawer, type ClaimWorkRecord } from "./claim-work-drawer";
import {
  getClaimsQueueData,
  retryRejectedClaims,
  type ClaimsQueueRow,
} from "./claims-queue-repository";
import {
  getClaimWorkData,
  type ClaimWorkData,
} from "./workspace-repository";
import "./rejections-workqueue.css";

type QueueStage = "action_required" | "in_correction" | "ready_to_resubmit" | "resolved";
type DetailTab = "rejection" | "claim" | "payer" | "history";
type GenericRow = Record<string, unknown> & { id: string };

type RejectionItem = {
  claim: ClaimsQueueRow;
  work: ClaimWorkData | null;
  categories: RejectionCategory[];
  messages: string[];
  rejectionCode: string;
  occurredAt: string | null;
  stage: QueueStage;
};

const stageLabels: Record<QueueStage, string> = {
  action_required: "Action Required",
  in_correction: "In Correction",
  ready_to_resubmit: "Ready to Resubmit",
  resolved: "Resolved",
};

const categoryLabels: Record<RejectionCategory, string> = {
  patient: "Patient Information",
  subscriber: "Subscriber Information",
  provider: "Provider Information",
  payer: "Payer Information",
  diagnosis: "Diagnosis",
  procedure_modifier: "Procedure / Modifier",
  authorization: "Authorization",
  claim_format: "Claim Format",
  other: "Other",
};

const targetLabels: Record<ClaimCorrectionTarget, string> = {
  patient_control_number: "Patient control number",
  payer_claim_number: "Payer claim number",
  service_date_from: "Date of service",
  service_date_to: "Date of service through",
  place_of_service_code: "Place of service",
  claim_frequency_code: "Claim frequency",
  total_charge_cents: "Total claim charge",
  claim_lines: "Service line",
  diagnoses: "Diagnosis",
  rendering_provider: "Rendering provider",
  payer: "Payer / routing",
  patient: "Patient / subscriber",
};

const ediLocations: Record<ClaimCorrectionTarget, string> = {
  patient_control_number: "837P CLM01 · CMS-1500 Box 26",
  payer_claim_number: "Payer-assigned claim reference",
  service_date_from: "837P DTP*472 · CMS-1500 Box 24A",
  service_date_to: "837P DTP*472 · CMS-1500 Box 24A",
  place_of_service_code: "837P SV105 · CMS-1500 Box 24B",
  claim_frequency_code: "837P CLM05-3 · claim frequency",
  total_charge_cents: "837P CLM02 · CMS-1500 Box 28",
  claim_lines: "837P SV1 · CMS-1500 Box 24D-G",
  diagnoses: "837P HI / SV107 · CMS-1500 Box 21/24E",
  rendering_provider: "837P 2310B · CMS-1500 Box 24J",
  payer: "837P receiver / payer routing",
  patient: "837P 2010BA/2010CA · subscriber/patient",
};

function splitMessages(value: unknown) {
  return String(value ?? "")
    .split(/(?<=\.)\s+/)
    .map((message) => message.trim())
    .filter(Boolean);
}

function asDrawerClaim(row: ClaimsQueueRow): ClaimWorkRecord {
  return {
    id: row.id,
    patientControlNumber: String(row.patient_control_number ?? ""),
    payerClaimNumber: row.payer_claim_number ? String(row.payer_claim_number) : null,
    claimStatus: String(row.claim_status ?? "rejected"),
    serviceDateFrom: row.service_date_from ? String(row.service_date_from) : null,
    totalChargeCents: Number(row.total_charge_cents ?? 0),
    clientName: row.clientName,
    payerName: row.payerName,
    renderingProviderName: row.providerName,
  };
}

function isRejectionHome(row: ClaimsQueueRow) {
  return getOperationalHome({
    claimStatus: row.claim_status,
    latestResponseStatus: row.clearinghouseStatus,
    hasActiveDenial: row.hasActiveDenial,
    openBalanceCents: row.openBalanceCents,
  }) === "rejections";
}

function workStage(claim: ClaimsQueueRow, work: ClaimWorkData | null): QueueStage {
  const status = String(claim.claim_status ?? "").toLowerCase();
  if (["corrected", "ready_for_validation", "ready_for_batch"].includes(status)) {
    return "ready_to_resubmit";
  }
  const active = (work?.workItems ?? []).find((row) =>
    ["claim_rejection", "claim_validation"].includes(String(row.workqueue_type ?? "")) &&
    !["completed", "cancelled", "closed"].includes(String(row.workqueue_status ?? "").toLowerCase()),
  );
  const workStatus = String(active?.workqueue_status ?? "").toLowerCase();
  if (["in_progress", "pending", "snoozed"].includes(workStatus)) return "in_correction";
  return "action_required";
}

function sameLocalDay(value: unknown) {
  if (!value) return false;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
}

function inDateWindow(item: RejectionItem, windowValue: string) {
  if (windowValue === "all" || !item.occurredAt) return true;
  const timestamp = new Date(item.occurredAt).getTime();
  if (Number.isNaN(timestamp)) return true;
  return Date.now() - timestamp <= Number(windowValue) * 24 * 60 * 60 * 1000;
}

function fallbackTarget(item: RejectionItem): ClaimCorrectionTarget {
  const category = item.categories[0];
  if (category === "provider") return "rendering_provider";
  if (category === "payer") return "payer";
  if (category === "patient" || category === "subscriber") return "patient";
  if (category === "diagnosis") return "diagnoses";
  if (category === "procedure_modifier") return "claim_lines";
  return "claim_lines";
}

function primaryMessage(item: RejectionItem) {
  return item.messages[0] || "The clearinghouse rejected this claim and requires a correction before resubmission.";
}

function targetDetails(item: RejectionItem) {
  const message = primaryMessage(item);
  const guidance = getClaimErrorGuidance(message);
  const target = guidance?.target ?? fallbackTarget(item);
  const line = item.work?.lines?.[0];
  const claim = item.work?.claim;
  let currentValue = "Blank / not available";

  if (target === "claim_lines") {
    if (message.toLowerCase().includes("modifier")) {
      currentValue = String(line?.modifier1 ?? line?.modifier_1 ?? "Blank");
    } else if (message.toLowerCase().includes("unit")) {
      currentValue = String(line?.units ?? "Blank");
    } else {
      currentValue = String(line?.cpt_code ?? "Blank");
    }
  } else if (target === "diagnoses") {
    currentValue = String(item.work?.diagnoses?.[0]?.diagnosis_code ?? "Blank");
  } else if (target === "rendering_provider") {
    currentValue = item.claim.providerName || "Blank";
  } else if (target === "payer") {
    currentValue = item.claim.payerName || "Blank";
  } else if (target === "patient") {
    currentValue = item.claim.clientName || "Blank";
  } else if (target === "total_charge_cents") {
    currentValue = money(Number(claim?.total_charge_cents ?? item.claim.total_charge_cents ?? 0));
  } else {
    currentValue = String(claim?.[target] ?? item.claim[target] ?? "Blank");
  }

  return {
    target,
    label: targetLabels[target],
    location: ediLocations[target],
    currentValue,
    guidance,
    line,
  };
}

export function RejectionsPage() {
  const [items, setItems] = useState<RejectionItem[]>([]);
  const [payerId, setPayerId] = useState("all");
  const [rejectionCode, setRejectionCode] = useState("all");
  const [dateWindow, setDateWindow] = useState("30");
  const [search, setSearch] = useState("");
  const [queueTab, setQueueTab] = useState<QueueStage>("action_required");
  const [detailTab, setDetailTab] = useState<DetailTab>("rejection");
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getClaimsQueueData();
      const candidates = data.filter((row) =>
        isRejectionHome(row) ||
        (sameLocalDay(row.updated_at) && ["corrected", "ready_for_validation", "ready_for_batch", "submitted", "accepted"].includes(String(row.claim_status ?? "").toLowerCase())),
      );

      const loaded = await Promise.all(candidates.map(async (claim): Promise<RejectionItem | null> => {
        const work = await getClaimWorkData(claim.id);
        const rejectedHome = isRejectionHome(claim);
        const rejectedResponses = (work?.responses ?? [])
          .filter((row) => String(row.response_status ?? "").toLowerCase().includes("reject"));
        if (!rejectedHome && rejectedResponses.length === 0) return null;

        const validationMessages = (work?.workItems ?? [])
          .filter((row) =>
            row.workqueue_type === "claim_validation" &&
            !["completed", "cancelled"].includes(String(row.workqueue_status ?? "")),
          )
          .flatMap((row) => splitMessages(row.description));
        const responseMessages = rejectedResponses
          .slice(0, 1)
          .flatMap((row) => splitMessages(row.response_message));
        const messages = [...responseMessages, ...validationMessages];
        const categories = getRejectionCategories(messages.length ? messages : ["Other claim correction required."]);
        const latestResponse = rejectedResponses[0];
        const rejectionCodeValue = String(latestResponse?.response_code ?? "").trim();

        return {
          claim,
          work,
          categories,
          messages,
          rejectionCode: rejectionCodeValue || categoryLabels[categories[0] ?? "other"],
          occurredAt: latestResponse?.created_at ? String(latestResponse.created_at) : claim.updated_at ? String(claim.updated_at) : null,
          stage: rejectedHome ? workStage(claim, work) : "resolved",
        };
      }));

      setItems(loaded.filter((item): item is RejectionItem => Boolean(item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Rejections.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const payerOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const item of items) values.set(String(item.claim.payer_id ?? "unassigned"), item.claim.payerName || "Unassigned Payer");
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const codeOptions = useMemo(
    () => [...new Set(items.map((item) => item.rejectionCode))].sort((a, b) => a.localeCompare(b)),
    [items],
  );

  const dateScopedItems = useMemo(
    () => items.filter((item) => inDateWindow(item, dateWindow)),
    [items, dateWindow],
  );

  const stats = useMemo(() => ({
    action_required: dateScopedItems.filter((item) => item.stage === "action_required").length,
    in_correction: dateScopedItems.filter((item) => item.stage === "in_correction").length,
    ready_to_resubmit: dateScopedItems.filter((item) => item.stage === "ready_to_resubmit").length,
    resolved: dateScopedItems.filter((item) => item.stage === "resolved" && sameLocalDay(item.occurredAt ?? item.claim.updated_at)).length,
  }), [dateScopedItems]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return dateScopedItems
      .filter((item) => item.stage === queueTab)
      .filter((item) => payerId === "all" || String(item.claim.payer_id ?? "unassigned") === payerId)
      .filter((item) => rejectionCode === "all" || item.rejectionCode === rejectionCode)
      .filter((item) => {
        if (!query) return true;
        return [
          item.claim.clientName,
          item.claim.payerName,
          item.claim.patient_control_number,
          item.rejectionCode,
          ...item.messages,
        ].some((value) => String(value ?? "").toLowerCase().includes(query));
      })
      .sort((a, b) => String(b.occurredAt ?? "").localeCompare(String(a.occurredAt ?? "")));
  }, [dateScopedItems, queueTab, payerId, rejectionCode, search]);

  useEffect(() => {
    if (!visible.length) {
      setActiveClaimId(null);
      return;
    }
    if (!visible.some((item) => item.claim.id === activeClaimId)) setActiveClaimId(visible[0].claim.id);
  }, [visible, activeClaimId]);

  useEffect(() => {
    setDetailTab("rejection");
    setNotice(null);
  }, [activeClaimId]);

  const activeIndex = visible.findIndex((item) => item.claim.id === activeClaimId);
  const activeItem = activeIndex >= 0 ? visible[activeIndex] : null;
  const activeTarget = activeItem ? targetDetails(activeItem) : null;

  async function startCorrection() {
    if (!activeItem) return;
    setBusy(true);
    setError(null);
    try {
      const existing = (activeItem.work?.workItems ?? []).find((row) =>
        String(row.workqueue_type ?? "") === "claim_rejection" &&
        !["completed", "cancelled", "closed"].includes(String(row.workqueue_status ?? "").toLowerCase()),
      );
      if (existing?.id) {
        await demoUpdate<GenericRow>("workqueue_items", String(existing.id), { workqueue_status: "in_progress" });
      } else {
        await demoInsert<GenericRow>("workqueue_items", {
          workqueue_type: "claim_rejection",
          workqueue_status: "in_progress",
          priority: "high",
          source_object_type: "claim",
          source_object_id: activeItem.claim.id,
          title: `Rejected claim correction: ${String(activeItem.claim.patient_control_number ?? activeItem.claim.id)}`,
          description: primaryMessage(activeItem),
        });
      }
      setEditorOpen(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start correction.");
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!activeItem) return;
    const note = window.prompt("Add a note to this rejection");
    if (!note?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      let workItem = (activeItem.work?.workItems ?? []).find((row) =>
        String(row.workqueue_type ?? "") === "claim_rejection" &&
        !["completed", "cancelled", "closed"].includes(String(row.workqueue_status ?? "").toLowerCase()),
      );
      if (!workItem) {
        workItem = await demoInsert<GenericRow>("workqueue_items", {
          workqueue_type: "claim_rejection",
          workqueue_status: "open",
          priority: "high",
          source_object_type: "claim",
          source_object_id: activeItem.claim.id,
          title: `Rejected claim correction: ${String(activeItem.claim.patient_control_number ?? activeItem.claim.id)}`,
          description: primaryMessage(activeItem),
        });
      }
      await demoInsert<GenericRow>("workqueue_history", {
        workqueue_item_id: workItem.id,
        old_status: String(workItem.workqueue_status ?? "open"),
        new_status: String(workItem.workqueue_status ?? "open"),
        note: note.trim(),
      });
      setNotice("Note added to the rejection work item.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add note.");
    } finally {
      setBusy(false);
    }
  }

  async function resubmitAndResolve() {
    if (!activeItem || activeItem.stage === "resolved") return;
    setBusy(true);
    setError(null);
    try {
      await retryRejectedClaims([activeItem.claim.id]);
      setNotice("Claim returned to validation. It will clear from Action Required once the correction passes revalidation.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to return claim to validation.");
    } finally {
      setBusy(false);
    }
  }

  const line = activeTarget?.line;
  const messageLower = activeItem ? primaryMessage(activeItem).toLowerCase() : "";

  return (
    <div className="rejections-page">
      <header className="rejections-page-header">
        <h1>Claim Rejection Workqueue</h1>
        <p>Translate 277CA and clearinghouse rejections into the exact correction required.</p>
      </header>

      <div className="rejections-kpis" aria-label="Rejection workqueue summary">
        {([
          ["action_required", "Action Required", stats.action_required, "Rejected claims"],
          ["in_correction", "In Correction", stats.in_correction, "Being worked"],
          ["ready_to_resubmit", "Ready to Resubmit", stats.ready_to_resubmit, "Errors cleared"],
          ["resolved", "Resolved Today", stats.resolved, "Resubmitted"],
        ] as const).map(([key, label, count, description]) => (
          <button
            type="button"
            key={key}
            className={`rejections-kpi ${key.replaceAll("_", "-")} ${queueTab === key ? "active" : ""}`}
            onClick={() => setQueueTab(key)}
          >
            {label}
            <strong>{count}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>

      <div className="rejections-filters">
        <select className="rejections-control" value={dateWindow} onChange={(event) => setDateWindow(event.target.value)} aria-label="Date range">
          <option value="30">Last 30 Days</option>
          <option value="90">Last 90 Days</option>
          <option value="all">All Dates</option>
        </select>
        <select className="rejections-control" value={payerId} onChange={(event) => setPayerId(event.target.value)} aria-label="Payer">
          <option value="all">All Payers</option>
          {payerOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <select className="rejections-control" value={rejectionCode} onChange={(event) => setRejectionCode(event.target.value)} aria-label="Rejection code">
          <option value="all">All Rejection Codes</option>
          {codeOptions.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
        <input
          className="rejections-control"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search patient, claim, rejection..."
          aria-label="Search rejections"
        />
      </div>

      {error && <div className="thera-state error">{error}</div>}
      {notice && <div className="rejections-message">{notice}</div>}
      {loading && <div className="thera-state">Loading Rejections...</div>}

      {!loading && (
        <div className="rejections-workspace">
          <section className="rejections-queue" aria-label="Rejected claims">
            <div className="rejections-tabs" role="tablist" aria-label="Rejection workflow status">
              {([
                ["action_required", "Action Required", stats.action_required],
                ["in_correction", "In Correction", stats.in_correction],
                ["ready_to_resubmit", "Ready to Resubmit", stats.ready_to_resubmit],
                ["resolved", "Resolved", stats.resolved],
              ] as const).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={queueTab === key}
                  className={`rejections-tab ${queueTab === key ? "active" : ""}`}
                  onClick={() => setQueueTab(key)}
                >
                  {label} ({count})
                </button>
              ))}
            </div>

            <div className="rejections-table-wrap">
              <table className="rejections-table">
                <thead>
                  <tr>
                    <th style={{ width: "15%" }}>Patient</th>
                    <th style={{ width: "10%" }}>DOS</th>
                    <th style={{ width: "11%" }}>Payer</th>
                    <th style={{ width: "13%" }}>Claim</th>
                    <th style={{ width: "10%" }}>Code</th>
                    <th style={{ width: "16%" }}>Rejection Reason</th>
                    <th style={{ width: "16%" }}>Correction Needed</th>
                    <th style={{ width: "9%" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => {
                    const guidance = getClaimErrorGuidance(primaryMessage(item));
                    return (
                      <tr
                        key={item.claim.id}
                        className={activeClaimId === item.claim.id ? "selected" : ""}
                        onClick={() => setActiveClaimId(item.claim.id)}
                      >
                        <td className="patient-cell">{item.claim.clientName}</td>
                        <td>{shortDate(String(item.claim.service_date_from ?? ""))}</td>
                        <td>{item.claim.payerName || "—"}</td>
                        <td>{String(item.claim.patient_control_number ?? item.claim.id)}</td>
                        <td className="rejections-code">{item.rejectionCode}</td>
                        <td>{primaryMessage(item)}</td>
                        <td>{guidance?.correction || `Correct ${targetLabels[fallbackTarget(item)].toLowerCase()} and revalidate the claim.`}</td>
                        <td><span className={`rejections-status ${item.stage.replaceAll("_", "-")}`}>{stageLabels[item.stage]}</span></td>
                      </tr>
                    );
                  })}
                  {!visible.length && (
                    <tr><td colSpan={8}><div className="rejections-empty">No claims match this workqueue and filter combination.</div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="rejections-footnote">A rejection remains in Action Required until the correction is made on the claim and it passes revalidation.</div>
          </section>

          <aside className="rejections-resolution" aria-label="Rejection Resolution">
            {!activeItem || !activeTarget ? (
              <div className="rejections-empty">Select a rejected claim to see the exact correction required.</div>
            ) : (
              <>
                <div className="rejections-resolution-header">
                  <div>
                    <h2>Rejection Resolution</h2>
                    <p>{activeItem.claim.clientName} · Claim {String(activeItem.claim.patient_control_number ?? activeItem.claim.id)}</p>
                  </div>
                  <span className={`rejections-status ${activeItem.stage.replaceAll("_", "-")}`}>{stageLabels[activeItem.stage]}</span>
                </div>

                <div className="rejections-detail-tabs" role="tablist" aria-label="Rejection detail">
                  {(["rejection", "claim", "payer", "history"] as DetailTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={detailTab === tab}
                      className={`rejections-detail-tab ${detailTab === tab ? "active" : ""}`}
                      onClick={() => setDetailTab(tab)}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>

                <div className="rejections-detail-body">
                  {detailTab === "rejection" && (
                    <>
                      <div className="rejections-alert">
                        <strong>{activeItem.rejectionCode} — {primaryMessage(activeItem)}</strong>
                        <p>This rejection is mapped to the claim field or service-line area that needs correction before the claim returns to validation.</p>
                      </div>

                      <section className="rejections-section">
                        <div className="rejections-section-title">Correction</div>
                        <dl className="rejections-facts">
                          <dt>Target Field</dt><dd>{activeTarget.label}</dd>
                          <dt>837P Location</dt><dd>{activeTarget.location}</dd>
                          <dt>Current Value</dt><dd>{activeTarget.currentValue}</dd>
                        </dl>
                      </section>

                      <section className="rejections-field-card">
                        <h3>Fix the exact field</h3>
                        <p>Update the rejected claim field, save it, and revalidate before resubmission.</p>
                        {line ? (
                          <div className="rejections-line-grid">
                            <div className={`rejections-line-field ${messageLower.includes("cpt") || messageLower.includes("hcpcs") ? "attention" : ""}`}>
                              <span>CPT / HCPCS</span><strong>{String(line.cpt_code ?? "—")}</strong>
                            </div>
                            <div className={`rejections-line-field ${messageLower.includes("modifier") ? "attention" : ""}`}>
                              <span>Modifier</span><strong>{String(line.modifier1 ?? line.modifier_1 ?? "—")}</strong>
                            </div>
                            <div className={`rejections-line-field ${messageLower.includes("unit") ? "attention" : ""}`}>
                              <span>Units</span><strong>{String(line.units ?? "—")}</strong>
                            </div>
                          </div>
                        ) : (
                          <div className="rejections-line-grid">
                            <div className="rejections-line-field attention">
                              <span>{activeTarget.label}</span><strong>{activeTarget.currentValue}</strong>
                            </div>
                          </div>
                        )}
                        <button type="button" className="rejections-primary" disabled={busy || activeItem.stage === "resolved"} onClick={() => void startCorrection()}>
                          {busy ? "Working..." : `Fix Claim — ${activeTarget.guidance?.actionLabel || `Correct ${activeTarget.label}`}`}
                        </button>
                      </section>

                      <div className="rejections-explanation"><strong>Why it matters:</strong> {activeTarget.guidance?.whyItMatters || "The rejected field must match the payer and 837P requirements before the clearinghouse can accept the claim for adjudication."}</div>

                      <div className="rejections-actions-grid">
                        {activeItem.claim.payer_id ? (
                          <Link className="rejections-secondary" style={{ display: "grid", placeItems: "center", textDecoration: "none" }} href={`/payers/${String(activeItem.claim.payer_id)}`}>View Payer Rule</Link>
                        ) : <button type="button" className="rejections-secondary" disabled>View Payer Rule</button>}
                        <button type="button" className="rejections-secondary" onClick={() => setDetailTab("history")}>View 277CA</button>
                        <button type="button" className="rejections-secondary" disabled={busy} onClick={() => void addNote()}>Add Note</button>
                        <button type="button" className="rejections-secondary" disabled={busy || activeItem.stage === "resolved"} onClick={() => void startCorrection()}>Start Correction</button>
                      </div>

                      <button type="button" className="rejections-resolve" disabled={busy || activeItem.stage === "resolved"} onClick={() => void resubmitAndResolve()}>
                        {activeItem.stage === "resolved" ? "Resolved" : "Resubmit & Resolve"}
                      </button>
                    </>
                  )}

                  {detailTab === "claim" && (
                    <div className="rejections-summary-card">
                      <strong>{String(activeItem.claim.patient_control_number ?? activeItem.claim.id)}</strong>
                      <p>Patient: {activeItem.claim.clientName}</p>
                      <p>DOS: {shortDate(String(activeItem.claim.service_date_from ?? ""))}</p>
                      <p>Rendering provider: {activeItem.claim.providerName || "—"}</p>
                      <p>Charge: {money(Number(activeItem.claim.total_charge_cents ?? 0))}</p>
                      <p>Claim status: {String(activeItem.claim.claim_status ?? "—").replaceAll("_", " ")}</p>
                      <button type="button" className="rejections-primary" style={{ marginTop: 10 }} onClick={() => setEditorOpen(true)}>Open Claim Correction</button>
                    </div>
                  )}

                  {detailTab === "payer" && (
                    <div className="rejections-summary-card">
                      <strong>{activeItem.claim.payerName || "Unassigned payer"}</strong>
                      <p>Rejection code: {activeItem.rejectionCode}</p>
                      <p>Correction routing: {activeTarget.location}</p>
                      {activeItem.claim.payer_id && <Link className="rejections-secondary" style={{ display: "grid", placeItems: "center", marginTop: 10, textDecoration: "none" }} href={`/payers/${String(activeItem.claim.payer_id)}`}>Open Payer Record</Link>}
                    </div>
                  )}

                  {detailTab === "history" && (
                    <section className="rejections-section">
                      <div className="rejections-section-title">277CA / Clearinghouse Responses</div>
                      {(activeItem.work?.responses ?? []).slice(0, 6).map((row) => (
                        <div key={row.id} className="rejections-history-card">
                          <strong>{String(row.response_code ?? row.response_status ?? "Response")}</strong>
                          <p>{String(row.response_message ?? "No response text recorded.")}</p>
                          <p>{row.created_at ? shortDate(String(row.created_at)) : ""}</p>
                        </div>
                      ))}
                      {(activeItem.work?.responses?.length ?? 0) === 0 && <div className="rejections-empty">No clearinghouse response history is recorded.</div>}
                      <div className="rejections-section-title" style={{ marginTop: 6 }}>Claim History</div>
                      {(activeItem.work?.history ?? []).slice(0, 6).map((row) => (
                        <div key={row.id} className="rejections-history-card">
                          <strong>{String(row.old_status ?? "—")} → {String(row.new_status ?? "—")}</strong>
                          <p>{String(row.reason ?? row.note ?? "Status changed")}</p>
                        </div>
                      ))}
                    </section>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      <ClaimWorkDrawer
        claim={activeItem ? asDrawerClaim(activeItem.claim) : null}
        open={editorOpen && Boolean(activeItem)}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) void load();
        }}
        queuePosition={activeItem ? `${activeIndex + 1} of ${visible.length}` : undefined}
        onPrevious={activeIndex > 0 ? () => setActiveClaimId(visible[activeIndex - 1].claim.id) : undefined}
        onNext={activeIndex >= 0 && activeIndex < visible.length - 1 ? () => setActiveClaimId(visible[activeIndex + 1].claim.id) : undefined}
        previousDisabled={activeIndex <= 0}
        nextDisabled={activeIndex < 0 || activeIndex >= visible.length - 1}
      />
    </div>
  );
}
