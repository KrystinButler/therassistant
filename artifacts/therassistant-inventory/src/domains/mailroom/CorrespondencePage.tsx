import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, shortDate } from "../../lib/format";
import {
  addCorrespondenceDocument,
  classifyCorrespondence,
  getCorrespondenceDetail,
  getMailroomReferenceData,
  linkCorrespondenceDocument,
  openCorrespondenceDocument,
  transitionCorrespondence,
} from "./repository";
import { availableCorrespondenceActions } from "./workflow";
import type {
  CorrespondenceAction,
  MailroomInboxItem,
  MailroomReferenceData,
} from "./types";

type AnyRow = Record<string, any> & { id: string };

const correspondenceTypes = [
  "eob",
  "denial_letter",
  "appeal",
  "reconsideration",
  "recoupment_notice",
  "refund_request",
  "credentialing_letter",
  "medical_record_request",
  "prior_authorization_notice",
  "payer_correspondence",
  "general_correspondence",
] as const;

function humanize(value: unknown) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function personName(row?: AnyRow | null) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function editFormFor(row: MailroomInboxItem) {
  return {
    subject: row.subject,
    correspondenceType: row.correspondence_type,
    payerId: row.payer_id ?? "",
    clientId: row.client_id ?? "",
    claimId: row.claim_id ?? "",
    providerId: row.provider_id ?? "",
    authorizationId: row.authorization_id ?? "",
    appealId: row.appeal_id ?? "",
    assignedUserId: row.assigned_user_id ?? "",
    dueDate: row.due_date ?? "",
    notes: row.notes ?? "",
  };
}

export function CorrespondencePage() {
  const [, params] = useRoute<{ id: string }>("/mailroom/:id");
  const id = params?.id ?? "";
  const [row, setRow] = useState<MailroomInboxItem | null>(null);
  const [refs, setRefs] = useState<MailroomReferenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<ReturnType<typeof editFormFor> | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [detail, referenceData] = await Promise.all([
        getCorrespondenceDetail(id),
        getMailroomReferenceData(),
      ]);
      setRow(detail);
      setRefs(referenceData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load correspondence.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  const clients = (refs?.clients ?? []) as AnyRow[];
  const providers = (refs?.providers ?? []) as AnyRow[];
  const payers = (refs?.payers ?? []) as AnyRow[];
  const claims = (refs?.claims ?? []) as AnyRow[];
  const authorizations = (refs?.authorizations ?? []) as AnyRow[];
  const appeals = (refs?.appeals ?? []) as AnyRow[];
  const documents = (refs?.documents ?? []) as AnyRow[];

  const filteredClaims = useMemo(() => {
    if (!editForm?.clientId) return claims;
    return claims.filter((claim) => String(claim.client_id ?? "") === editForm.clientId);
  }, [claims, editForm?.clientId]);

  const filteredAuthorizations = useMemo(() => {
    if (!editForm?.clientId) return authorizations;
    return authorizations.filter((authorization) => String(authorization.client_id ?? "") === editForm.clientId);
  }, [authorizations, editForm?.clientId]);

  const filteredAppeals = useMemo(() => {
    if (!editForm) return appeals;
    if (editForm.claimId) return appeals.filter((appeal) => String(appeal.claim_id ?? "") === editForm.claimId);
    if (!editForm.clientId) return appeals;
    const claimIds = new Set(filteredClaims.map((claim) => String(claim.id)));
    return appeals.filter((appeal) => claimIds.has(String(appeal.claim_id ?? "")));
  }, [appeals, editForm, filteredClaims]);

  async function executeAction(action: CorrespondenceAction) {
    if (!row) return;
    const needsReason = ["pend", "resolve", "close", "reopen"].includes(action);
    let reason: string | undefined;
    if (needsReason) {
      const entered = window.prompt(`${humanize(action)} reason`);
      if (!entered?.trim()) {
        setError(`A reason is required to ${humanize(action).toLowerCase()} this correspondence.`);
        return;
      }
      reason = entered.trim();
    } else if (action === "review") {
      reason = "Correspondence reviewed.";
    } else if (action === "require_action") {
      reason = "Correspondence requires follow-up.";
    } else if (action === "start") {
      reason = "Correspondence work started.";
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await transitionCorrespondence(row.id, action, reason);
      setMessage(`${humanize(action)} completed.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update correspondence.");
    } finally {
      setSaving(false);
    }
  }

  function openEdit() {
    if (!row) return;
    setEditForm(editFormFor(row));
    setEditOpen(true);
  }

  async function saveClassification() {
    if (!row || !editForm) return;
    if (!editForm.subject.trim()) {
      setError("Subject is required.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await classifyCorrespondence(row.id, {
        subject: editForm.subject.trim(),
        correspondenceType: editForm.correspondenceType,
        payerId: editForm.payerId || null,
        clientId: editForm.clientId || null,
        claimId: editForm.claimId || null,
        providerId: editForm.providerId || null,
        authorizationId: editForm.authorizationId || null,
        appealId: editForm.appealId || null,
        assignedUserId: editForm.assignedUserId || null,
        dueDate: editForm.dueDate || null,
        notes: editForm.notes.trim() || null,
      });
      setEditOpen(false);
      setMessage("Correspondence details updated.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update correspondence details.");
    } finally {
      setSaving(false);
    }
  }

  async function attachExistingDocument() {
    if (!row || !selectedDocumentId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await linkCorrespondenceDocument(row.id, selectedDocumentId);
      setSelectedDocumentId("");
      setMessage("Document linked.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to link document.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadDocument() {
    if (!row || !uploadFile) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await addCorrespondenceDocument(row, uploadFile);
      setUploadFile(null);
      setMessage("Document uploaded and linked.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload document.");
    } finally {
      setSaving(false);
    }
  }

  async function openDocument() {
    const path = String(row?.document?.storage_path ?? "");
    if (!path) {
      setError("This document does not have a valid stored file path.");
      return;
    }
    setError(null);
    try {
      const url = await openCorrespondenceDocument(path, 300);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open document.");
    }
  }

  if (loading) return <div className="thera-state">Loading correspondence...</div>;
  if (error && !row) return <div className="thera-state error">{error}</div>;
  if (!row) {
    return <div className="thera-state error">Correspondence not found. <Link className="thera-link" href="/mailroom">Return to Mailroom</Link></div>;
  }

  const actions = availableCorrespondenceActions(row.status);
  const document = row.document as AnyRow | null;

  return (
    <>
      <div className="thera-breadcrumb"><Link className="thera-link" href="/mailroom">Mailroom</Link><span>/</span><span>{row.subject}</span></div>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">CORRESPONDENCE 360</div>
          <h1>{row.subject}</h1>
          <p>{humanize(row.correspondenceType)} · Received {shortDate(row.receivedDate)}</p>
        </div>
        <div className="thera-filter-row">
          <button type="button" className="thera-action secondary" onClick={openEdit}>Edit Details</button>
          {actions.map((action) => (
            <button
              type="button"
              className={action.action === "resolve" || action.action === "close" ? "thera-action" : "thera-action secondary"}
              disabled={saving}
              key={action.action}
              onClick={() => void executeAction(action.action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="thera-metric-grid">
        <Metric label="Status" value={<StatusBadge value={row.status} />} />
        <Metric label="Due" value={row.dueDate ? shortDate(row.dueDate) : "No due date"} detail={row.dueState === "none" ? undefined : humanize(row.dueState)} />
        <Metric label="Payer" value={row.payerName} />
        <Metric label="Assignee" value={row.assigneeName} />
      </div>

      <div className="thera-detail-grid">
        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Linked Context</h2><p>Operational records affected by this correspondence.</p></div></div>
          <div className="thera-definition-grid">
            <LinkedField label="Patient" value={row.patientName} href={row.client_id ? `/clients/${row.client_id}` : null} />
            <LinkedField label="Claim" value={row.claimNumber} href={row.claim_id ? `/claims/${row.claim_id}` : null} />
            <LinkedField label="Provider" value={row.providerName} href={row.provider_id ? `/providers/${row.provider_id}` : null} />
            <LinkedField label="Payer" value={row.payerName} href={row.payer_id ? `/payers/${row.payer_id}` : null} />
            <LinkedField label="Authorization" value={row.authorizationNumber} href={row.authorization_id ? "/authorizations" : null} />
            <LinkedField label="Appeal" value={row.appealLabel} href={row.appeal_id ? "/ar-denials" : null} />
          </div>
          <div style={{ marginTop: 16 }}><div className="thera-field-label">Notes</div><div>{String(row.notes || "No notes.")}</div></div>
        </section>

        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Primary Document</h2><p>Private correspondence file stored in Therassistant.</p></div></div>
          {document ? (
            <div className="thera-story">
              <strong>{String(document.file_name || "Document")}</strong>
              <div className="thera-table-subtext">{humanize(document.document_type)} · {humanize(document.document_status)}</div>
              <div className="thera-filter-row" style={{ marginTop: 12 }}>
                <button type="button" className="thera-action" onClick={() => void openDocument()}>Open / Download</button>
              </div>
            </div>
          ) : row.documentMissing ? (
            <div className="thera-state error">The linked document record is unavailable.</div>
          ) : (
            <div className="thera-empty">No primary document is linked.</div>
          )}
          <div className="thera-stack" style={{ marginTop: 16 }}>
            <label><div className="thera-field-label">Link Existing Document</div><select className="thera-select" value={selectedDocumentId} onChange={(event) => setSelectedDocumentId(event.target.value)}><option value="">Choose document</option>{documents.map((item) => <option key={item.id} value={item.id}>{String(item.file_name || "Document")}</option>)}</select></label>
            <button type="button" className="thera-action secondary" disabled={!selectedDocumentId || saving} onClick={() => void attachExistingDocument()}>Link Document</button>
            <label><div className="thera-field-label">Upload New Document</div><input className="thera-input" type="file" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} /></label>
            <button type="button" className="thera-action secondary" disabled={!uploadFile || saving} onClick={() => void uploadDocument()}>Upload & Link</button>
          </div>
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header"><div><h2>Correspondence Work</h2><p>Work Center follow-up connected to this correspondence.</p></div><Link className="thera-action secondary" href="/work-center">Open Work Center</Link></div>
          {row.correspondenceWork.length === 0 ? <div className="thera-empty">No correspondence work has been created.</div> : (
            <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Work</th><th>Status</th><th>Priority</th><th>Due</th><th>Created</th></tr></thead><tbody>{row.correspondenceWork.map((work) => <tr key={work.id}><td>{String(work.title || row.subject)}</td><td><StatusBadge value={String(work.workqueue_status || "open")} /></td><td><StatusBadge value={String(work.priority || "normal")} /></td><td>{work.due_date ? shortDate(String(work.due_date)) : "—"}</td><td>{work.created_at ? dateTime(String(work.created_at)) : "—"}</td></tr>)}</tbody></table></div>
          )}
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header"><div><h2>Status History</h2><p>Auditable correspondence lifecycle.</p></div></div>
          {row.statusHistory.length === 0 ? <div className="thera-empty">No correspondence history is recorded yet.</div> : (
            <div className="thera-stack">{row.statusHistory.map((history) => <div className="thera-work-card" key={history.id}><div className="thera-work-card-top"><span>{history.created_at ? dateTime(String(history.created_at)) : "—"}</span><span>{history.old_status ? humanize(history.old_status) : "Created"} · {humanize(history.new_status)}</span></div>{history.reason && <div>{String(history.reason)}</div>}</div>)}</div>
          )}
        </section>
      </div>

      {editOpen && editForm && refs && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 1000, padding: 20 }}>
          <section className="thera-card" style={{ width: "min(900px,100%)", maxHeight: "92vh", overflow: "auto" }}>
            <div className="thera-card-header"><div><h2>Edit Correspondence Details</h2><p>Classification and linked context only. Status is controlled by workflow actions.</p></div><button type="button" className="thera-action secondary" onClick={() => setEditOpen(false)}>Close</button></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
              <Field label="Subject"><input className="thera-input" value={editForm.subject} onChange={(event) => setEditForm({ ...editForm, subject: event.target.value })} /></Field>
              <Field label="Type"><select className="thera-select" value={editForm.correspondenceType} onChange={(event) => setEditForm({ ...editForm, correspondenceType: event.target.value })}>{correspondenceTypes.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></Field>
              <Field label="Payer"><select className="thera-select" value={editForm.payerId} onChange={(event) => setEditForm({ ...editForm, payerId: event.target.value })}><option value="">No payer</option>{payers.map((item) => <option key={item.id} value={item.id}>{String(item.name || "Payer")}</option>)}</select></Field>
              <Field label="Patient"><select className="thera-select" value={editForm.clientId} onChange={(event) => setEditForm({ ...editForm, clientId: event.target.value, claimId: "", authorizationId: "", appealId: "" })}><option value="">No patient</option>{clients.map((item) => <option key={item.id} value={item.id}>{personName(item)}</option>)}</select></Field>
              <Field label="Claim"><select className="thera-select" value={editForm.claimId} onChange={(event) => setEditForm({ ...editForm, claimId: event.target.value, appealId: "" })}><option value="">No claim</option>{filteredClaims.map((item) => <option key={item.id} value={item.id}>{String(item.patient_control_number || item.payer_claim_number || "Claim")}</option>)}</select></Field>
              <Field label="Provider"><select className="thera-select" value={editForm.providerId} onChange={(event) => setEditForm({ ...editForm, providerId: event.target.value })}><option value="">No provider</option>{providers.map((item) => <option key={item.id} value={item.id}>{personName(item)}{item.credentials ? `, ${item.credentials}` : ""}</option>)}</select></Field>
              <Field label="Authorization"><select className="thera-select" value={editForm.authorizationId} onChange={(event) => setEditForm({ ...editForm, authorizationId: event.target.value })}><option value="">No authorization</option>{filteredAuthorizations.map((item) => <option key={item.id} value={item.id}>{String(item.authorization_number || "Authorization")}</option>)}</select></Field>
              <Field label="Appeal"><select className="thera-select" value={editForm.appealId} onChange={(event) => setEditForm({ ...editForm, appealId: event.target.value })}><option value="">No appeal</option>{filteredAppeals.map((item) => <option key={item.id} value={item.id}>{humanize(item.appeal_level || "appeal")} · {humanize(item.appeal_status || "unknown")}</option>)}</select></Field>
              <Field label="Due Date"><input className="thera-input" type="date" value={editForm.dueDate} onChange={(event) => setEditForm({ ...editForm, dueDate: event.target.value })} /></Field>
              <Field label="Assignee"><select className="thera-select" value={editForm.assignedUserId} onChange={(event) => setEditForm({ ...editForm, assignedUserId: event.target.value })}><option value="">Unassigned</option>{refs.assignees.map((item) => <option key={item.user_id} value={item.user_id}>{item.display_label}</option>)}</select></Field>
              <label style={{ gridColumn: "1 / -1" }}><div className="thera-field-label">Notes</div><textarea className="thera-input" rows={4} value={editForm.notes} onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })} /></label>
            </div>
            <div style={{ marginTop: 16 }}><button type="button" className="thera-action" disabled={saving} onClick={() => void saveClassification()}>{saving ? "Saving..." : "Save Details"}</button></div>
          </section>
        </div>
      )}
    </>
  );
}

function Metric({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return <div className="thera-metric-card"><div className="thera-metric-label">{label}</div><div className="thera-metric-value" style={{ fontSize: 18 }}>{value}</div>{detail && <div className="thera-table-subtext">{detail}</div>}</div>;
}

function LinkedField({ label, value, href }: { label: string; value: string; href: string | null }) {
  return <div><div className="thera-field-label">{label}</div><div className="thera-field-value">{href ? <Link className="thera-link" href={href}>{value}</Link> : value}</div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><div className="thera-field-label">{label}</div>{children}</label>;
}
