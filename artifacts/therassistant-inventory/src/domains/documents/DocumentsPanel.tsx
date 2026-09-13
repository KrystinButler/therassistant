import { useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { dateTime } from "../../lib/format";
import type { PatientChart } from "../patients/types";
import { addSyntheticDocumentMetadata } from "./repository";

export function DocumentsPanel({ chart, onChanged }: { chart: PatientChart; onChanged: () => Promise<void> }) {
  const [showForm, setShowForm] = useState(false);
  const [fileName, setFileName] = useState("");
  const [documentType, setDocumentType] = useState("other");
  const [mimeType, setMimeType] = useState("application/pdf");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      await addSyntheticDocumentMetadata(chart.patient.id, { fileName, documentType, mimeType });
      setFileName(""); setDocumentType("other"); setShowForm(false); await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to add document metadata."); }
    finally { setSaving(false); }
  }

  return <section className="thera-card">
    <div className="thera-card-header split"><div><h2>Documents</h2><p>Chart-linked document metadata. The public demo does not create or expose downloadable document bytes.</p></div><button type="button" className="thera-action" onClick={() => setShowForm(true)}>+ Add Document Record</button></div>
    {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
    {showForm && <div className="thera-form-grid" style={{ marginBottom: 18 }}>
      <label className="thera-field"><span className="thera-field-label">File Name</span><input className="thera-input" value={fileName} onChange={(e) => setFileName(e.target.value)} /></label>
      <label className="thera-field"><span className="thera-field-label">Document Type</span><select className="thera-input" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>{["insurance_card","intake_form","consent_form","clinical_note","treatment_plan","assessment","authorization_letter","eob","appeal_letter","payer_correspondence","client_correspondence","claim_attachment","invoice","statement","other"].map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
      <label className="thera-field"><span className="thera-field-label">MIME Type</span><input className="thera-input" value={mimeType} onChange={(e) => setMimeType(e.target.value)} /></label>
      <div className="thera-filter-row"><button type="button" className="thera-action" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save Metadata"}</button><button type="button" className="thera-action secondary" onClick={() => setShowForm(false)}>Cancel</button></div>
    </div>}
    {chart.documents.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Created</th><th>Type</th><th>File Name</th><th>Status</th><th>Storage</th></tr></thead><tbody>{chart.documents.map((row) => <tr key={row.id}><td>{dateTime(String(row.created_at ?? ""))}</td><td>{String(row.document_type ?? "other").replaceAll("_", " ")}</td><td>{String(row.file_name ?? "—")}</td><td><StatusBadge value={String(row.document_status ?? "uploaded")} /></td><td>{String(row.storage_path ?? "").startsWith("synthetic-demo/metadata-only/") ? "Metadata only" : "Stored document"}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No patient documents are indexed.</div>}
  </section>;
}
