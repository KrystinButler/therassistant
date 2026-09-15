import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { shortDate } from "../../lib/format";
import {
  addCorrespondenceDocument,
  createCorrespondence,
  getMailroomInbox,
  getMailroomReferenceData,
  linkCorrespondenceDocument,
  transitionCorrespondence,
} from "./repository";
import { filterAndSortMailroomItems } from "./workflow";
import type {
  CorrespondenceDueState,
  MailroomInboxItem,
  MailroomReferenceData,
} from "./types";

type AnyRow = Record<string, any> & { id: string };
type SortMode = "newest" | "oldest" | "due";

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

const statuses = [
  "new",
  "reviewed",
  "action_required",
  "in_progress",
  "pending",
  "resolved",
  "closed",
] as const;

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function personName(row?: AnyRow | null) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function emptyForm() {
  return {
    subject: "",
    receivedDate: new Date().toISOString().slice(0, 10),
    correspondenceType: "payer_correspondence",
    payerId: "",
    clientId: "",
    claimId: "",
    providerId: "",
    authorizationId: "",
    appealId: "",
    dueDate: "",
    notes: "",
    assignedUserId: "",
    documentId: "",
    requiresAction: false,
  };
}

export function MailroomPage() {
  const [, setLocation] = useLocation();
  const [rows, setRows] = useState<MailroomInboxItem[]>([]);
  const [referenceData, setReferenceData] = useState<MailroomReferenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState<File | null>(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [payer, setPayer] = useState("all");
  const [assignment, setAssignment] = useState("all");
  const [due, setDue] = useState<"all" | CorrespondenceDueState>("all");
  const [sort, setSort] = useState<SortMode>("newest");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [items, refs] = await Promise.all([
        getMailroomInbox(),
        getMailroomReferenceData(),
      ]);
      setRows(items);
      setReferenceData(refs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Mailroom.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => filterAndSortMailroomItems(rows, {
    search,
    status: status === "all" ? undefined : status,
    correspondenceType: type === "all" ? undefined : type,
    payerName: payer === "all" ? undefined : payer,
    assignedUserId: assignment === "all" ? undefined : assignment === "unassigned" ? null : assignment,
    dueState: due === "all" ? undefined : due,
    sort,
  }), [rows, search, status, type, payer, assignment, due, sort]);

  const clients = (referenceData?.clients ?? []) as AnyRow[];
  const providers = (referenceData?.providers ?? []) as AnyRow[];
  const payers = (referenceData?.payers ?? []) as AnyRow[];
  const claims = (referenceData?.claims ?? []) as AnyRow[];
  const authorizations = (referenceData?.authorizations ?? []) as AnyRow[];
  const appeals = (referenceData?.appeals ?? []) as AnyRow[];
  const documents = (referenceData?.documents ?? []) as AnyRow[];

  const formClaims = form.clientId
    ? claims.filter((claim) => String(claim.client_id ?? "") === form.clientId)
    : claims;
  const formAuthorizations = form.clientId
    ? authorizations.filter((authorization) => String(authorization.client_id ?? "") === form.clientId)
    : authorizations;
  const clientClaimIds = new Set(formClaims.map((claim) => String(claim.id)));
  const formAppeals = form.claimId
    ? appeals.filter((appeal) => String(appeal.claim_id ?? "") === form.claimId)
    : form.clientId
      ? appeals.filter((appeal) => clientClaimIds.has(String(appeal.claim_id ?? "")))
      : appeals;
  const formDocuments = form.clientId
    ? documents.filter((document) => !document.client_id || String(document.client_id) === form.clientId)
    : documents;

  async function saveCorrespondence() {
    if (!form.subject.trim()) {
      setError("Subject is required.");
      return;
    }
    if (file && form.documentId) {
      setError("Choose either an existing document or a new file, not both.");
      return;
    }

    setSaving(true);
    setError(null);
    let created = false;
    try {
      let correspondence = await createCorrespondence({
        subject: form.subject.trim(),
        receivedDate: form.receivedDate,
        correspondenceType: form.correspondenceType,
        payerId: form.payerId || null,
        clientId: form.clientId || null,
        claimId: form.claimId || null,
        providerId: form.providerId || null,
        authorizationId: form.authorizationId || null,
        appealId: form.appealId || null,
        assignedUserId: form.assignedUserId || null,
        dueDate: form.dueDate || null,
        notes: form.notes.trim() || null,
      });
      created = true;

      if (form.documentId) {
        correspondence = await linkCorrespondenceDocument(correspondence.id, form.documentId);
      } else if (file) {
        correspondence = await addCorrespondenceDocument(correspondence, file);
      }

      if (form.requiresAction) {
        correspondence = await transitionCorrespondence(
          correspondence.id,
          "require_action",
          "Action required when correspondence was added.",
        );
      }

      setShowNew(false);
      setForm(emptyForm());
      setFile(null);
      await load();
      setLocation(`/mailroom/${correspondence.id}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown error.";
      setError(created
        ? `The correspondence was created, but follow-up setup did not finish. ${detail}`
        : `Unable to create correspondence. ${detail}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">CORRESPONDENCE OPERATIONS</div>
          <h1>Mailroom</h1>
          <p>Receive, classify, link, route, and work payer and administrative correspondence.</p>
        </div>
        <button type="button" className="thera-action" onClick={() => { setError(null); setShowNew(true); }}>+ Add Correspondence</button>
      </div>

      <section className="thera-card" style={{ marginBottom: 16 }}>
        <div className="thera-filter-row">
          <input className="thera-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Subject, patient, claim, payer, or provider" />
          <select className="thera-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select>
          <select className="thera-select" value={type} onChange={(event) => setType(event.target.value)}><option value="all">All correspondence</option>{correspondenceTypes.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select>
          <select className="thera-select" value={payer} onChange={(event) => setPayer(event.target.value)}><option value="all">All payers</option>{[...new Set(rows.map((row) => row.payerName).filter((name) => name !== "—"))].sort().map((name) => <option key={name} value={name}>{name}</option>)}</select>
          <select className="thera-select" value={assignment} onChange={(event) => setAssignment(event.target.value)}><option value="all">All assignments</option><option value="unassigned">Unassigned</option>{referenceData?.assignees.map((item) => <option key={item.user_id} value={item.user_id}>{item.display_label}</option>)}</select>
          <select className="thera-select" value={due} onChange={(event) => setDue(event.target.value as typeof due)}><option value="all">All due dates</option><option value="overdue">Overdue</option><option value="due_soon">Due soon</option><option value="current">Current</option><option value="none">No due date</option></select>
          <select className="thera-select" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="due">Due date</option></select>
        </div>
      </section>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}

      <section className="thera-card">
        {loading && <div className="thera-state">Loading Mailroom...</div>}
        {!loading && filtered.length === 0 && <div className="thera-empty">No correspondence matches these filters.</div>}
        {!loading && filtered.length > 0 && (
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead><tr><th>Received</th><th>Subject</th><th>Type</th><th>Payer</th><th>Patient</th><th>Claim</th><th>Provider</th><th>Due</th><th>Assignee</th><th>Status</th><th>Action</th><th></th></tr></thead>
              <tbody>{filtered.map((row) => <tr key={row.id}>
                <td>{shortDate(row.receivedDate)}</td>
                <td><strong>{row.subject}</strong></td>
                <td>{humanize(row.correspondenceType)}</td>
                <td>{row.payerName}</td>
                <td>{row.patientName}</td>
                <td>{row.claimNumber}</td>
                <td>{row.providerName}</td>
                <td>{row.dueDate ? shortDate(row.dueDate) : "—"}<div className="thera-table-subtext">{row.dueState === "none" ? "" : humanize(row.dueState)}</div></td>
                <td>{row.assigneeName}</td>
                <td><StatusBadge value={String(row.status)} /></td>
                <td>{row.activeWork ? <><StatusBadge value={String(row.activeWork.priority ?? "normal")} /><div className="thera-table-subtext">Follow-up active</div></> : row.status === "action_required" ? "Follow-up required" : "—"}</td>
                <td><Link className="thera-action secondary" href={`/mailroom/${row.id}`}>Open</Link></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      {showNew && referenceData && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 1000, padding: 20 }}>
          <section className="thera-card" style={{ width: "min(900px,100%)", maxHeight: "92vh", overflow: "auto" }}>
            <div className="thera-card-header"><div><h2>Add Correspondence</h2><p>Link the correspondence to the operational records it affects.</p></div><button type="button" className="thera-action secondary" onClick={() => setShowNew(false)}>Close</button></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
              <Field label="Subject"><input className="thera-input" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /></Field>
              <Field label="Received Date"><input className="thera-input" type="date" value={form.receivedDate} onChange={(event) => setForm({ ...form, receivedDate: event.target.value })} /></Field>
              <Field label="Type"><select className="thera-select" value={form.correspondenceType} onChange={(event) => setForm({ ...form, correspondenceType: event.target.value })}>{correspondenceTypes.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></Field>
              <Field label="Payer"><select className="thera-select" value={form.payerId} onChange={(event) => setForm({ ...form, payerId: event.target.value })}><option value="">No payer</option>{payers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
              <Field label="Patient"><select className="thera-select" value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value, claimId: "", authorizationId: "", appealId: "" })}><option value="">No patient</option>{clients.map((row) => <option key={row.id} value={row.id}>{personName(row)}</option>)}</select></Field>
              <Field label="Claim"><select className="thera-select" value={form.claimId} onChange={(event) => setForm({ ...form, claimId: event.target.value, appealId: "" })}><option value="">No claim</option>{formClaims.map((row) => <option key={row.id} value={row.id}>{row.patient_control_number || row.payer_claim_number || "Claim"}</option>)}</select></Field>
              <Field label="Provider"><select className="thera-select" value={form.providerId} onChange={(event) => setForm({ ...form, providerId: event.target.value })}><option value="">No provider</option>{providers.map((row) => <option key={row.id} value={row.id}>{personName(row)}{row.credentials ? `, ${row.credentials}` : ""}</option>)}</select></Field>
              <Field label="Authorization"><select className="thera-select" value={form.authorizationId} onChange={(event) => setForm({ ...form, authorizationId: event.target.value })}><option value="">No authorization</option>{formAuthorizations.map((row) => <option key={row.id} value={row.id}>{row.authorization_number || "Authorization"}</option>)}</select></Field>
              <Field label="Appeal"><select className="thera-select" value={form.appealId} onChange={(event) => setForm({ ...form, appealId: event.target.value })}><option value="">No appeal</option>{formAppeals.map((row) => <option key={row.id} value={row.id}>{humanize(String(row.appeal_level || "appeal"))} · {humanize(String(row.appeal_status || "unknown"))}</option>)}</select></Field>
              <Field label="Due Date"><input className="thera-input" type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></Field>
              <Field label="Assignee"><select className="thera-select" value={form.assignedUserId} onChange={(event) => setForm({ ...form, assignedUserId: event.target.value })}><option value="">Unassigned</option>{referenceData.assignees.map((row) => <option key={row.user_id} value={row.user_id}>{row.display_label}</option>)}</select></Field>
              <Field label="Existing Document"><select className="thera-select" value={form.documentId} onChange={(event) => setForm({ ...form, documentId: event.target.value })}><option value="">No existing document</option>{formDocuments.map((row) => <option key={row.id} value={row.id}>{row.file_name || "Document"}</option>)}</select></Field>
              <Field label="Upload New Document"><input className="thera-input" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={form.requiresAction} onChange={(event) => setForm({ ...form, requiresAction: event.target.checked })} /> Requires action</label>
              <label style={{ gridColumn: "1 / -1" }}><div className="thera-field-label">Notes</div><textarea className="thera-input" rows={4} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            </div>
            <div style={{ marginTop: 16 }}><button type="button" className="thera-action" disabled={saving} onClick={() => void saveCorrespondence()}>{saving ? "Saving..." : "Save Correspondence"}</button></div>
          </section>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><div className="thera-field-label">{label}</div>{children}</label>;
}
