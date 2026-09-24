import { useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { dateTime } from "../../lib/format";
import type { PatientChart } from "../patients/types";
import { downloadPatientDocument, isMetadataOnlyDocument, uploadPatientDocument } from "./repository";

const types = ["insurance_card","intake_form","consent_form","clinical_note","treatment_plan","assessment","authorization_letter","eob","appeal_letter","payer_correspondence","client_correspondence","claim_attachment","invoice","statement","other"];

export function DocumentsPanel({ chart, onChanged }: { chart: PatientChart; onChanged: () => Promise<void> }) {
  const [showForm, setShowForm] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("other");
  const [saving, setSaving] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    if (!file) { setError("Select the document file before uploading."); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      await uploadPatientDocument(chart.patient.id, file, documentType);
      setFile(null); setDocumentType("other"); setShowForm(false); setNotice("Document uploaded to private chart storage."); await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to upload document."); }
    finally { setSaving(false); }
  }

  async function download(row: Record<string, unknown>) {
    setDownloadingId(String(row.id ?? "")); setError(null);
    try { await downloadPatientDocument(row); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to download document."); }
    finally { setDownloadingId(null); }
  }

  return <section className="thera-card">
    <div className="thera-card-header split"><div><h2>Documents</h2><p>Upload and download patient documents from private, tenant-scoped chart storage. Legacy metadata-only demo records are identified separately.</p></div><button type="button" className="thera-action" onClick={() => setShowForm(true)}>+ Upload Document</button></div>
    {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
    {notice && <div className="thera-alert" style={{ marginBottom: 12 }}>{notice}</div>}
    {showForm && <div className="thera-form-grid" style={{ marginBottom: 18 }}>
      <label className="thera-field thera-span-2"><span className="thera-field-label">Choose file (50 MB maximum)</span><input className="thera-input" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={saving} /></label>
      <label className="thera-field"><span className="thera-field-label">Document Type</span><select className="thera-input" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>{types.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
      <div className="thera-filter-row"><button type="button" className="thera-action" disabled={saving || !file} onClick={() => void save()}>{saving ? "Uploading..." : "Upload to Chart"}</button><button type="button" className="thera-action secondary" disabled={saving} onClick={() => setShowForm(false)}>Cancel</button></div>
    </div>}
    {chart.documents.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Created</th><th>Type</th><th>File Name</th><th>Status</th><th>File</th></tr></thead><tbody>{chart.documents.map((row) => <tr key={row.id}><td>{dateTime(String(row.created_at ?? ""))}</td><td>{String(row.document_type ?? "other").replaceAll("_", " ")}</td><td>{String(row.file_name ?? "—")}</td><td><StatusBadge value={String(row.document_status ?? "uploaded")} /></td><td>{isMetadataOnlyDocument(row) ? "Metadata only — no file" : <button type="button" className="thera-action secondary" disabled={downloadingId === row.id} onClick={() => void download(row)}>{downloadingId === row.id ? "Downloading..." : "Download"}</button>}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No patient documents are indexed.</div>}
  </section>;
}
