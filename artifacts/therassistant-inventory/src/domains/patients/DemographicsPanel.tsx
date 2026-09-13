import { useState } from "react";

import type { PatientChart } from "./types";
import {
  addPatientContact,
  updatePatientContact,
  updatePatientDemographics,
  type ContactDraft,
  type DemographicsDraft,
} from "./workflow";

function value(row: Record<string, unknown>, key: string) {
  return String(row[key] ?? "");
}

export function DemographicsPanel({ chart, onChanged }: { chart: PatientChart; onChanged: () => Promise<void> }) {
  const patient = chart.patient;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<DemographicsDraft>(() => ({
    firstName: value(patient, "first_name"),
    middleName: value(patient, "middle_name"),
    lastName: value(patient, "last_name"),
    preferredName: value(patient, "preferred_name"),
    dateOfBirth: value(patient, "date_of_birth"),
    email: value(patient, "email"),
    phone: value(patient, "phone"),
    addressLine1: value(patient, "address_line1"),
    addressLine2: value(patient, "address_line2"),
    city: value(patient, "city"),
    state: value(patient, "state"),
    postalCode: value(patient, "postal_code"),
    clientStatus: value(patient, "client_status") || "active",
    registrationStatus: value(patient, "registration_status") || "in_progress",
  }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updatePatientDemographics(patient.id, form);
      await onChanged();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save patient demographics.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="thera-detail-grid">
      <section className="thera-card thera-span-2">
        <div className="thera-card-header split">
          <div><h2>Demographics</h2><p>Core patient registration information used throughout scheduling, clinical, and billing workflows.</p></div>
          <button type="button" className="thera-action secondary" onClick={() => setEditing((current) => !current)}>{editing ? "Cancel" : "Edit"}</button>
        </div>
        {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
        {editing ? (
          <div className="thera-form-grid">
            <Text label="First Name" value={form.firstName} onChange={(firstName) => setForm({ ...form, firstName })} />
            <Text label="Middle Name" value={form.middleName ?? ""} onChange={(middleName) => setForm({ ...form, middleName })} />
            <Text label="Last Name" value={form.lastName} onChange={(lastName) => setForm({ ...form, lastName })} />
            <Text label="Preferred Name" value={form.preferredName ?? ""} onChange={(preferredName) => setForm({ ...form, preferredName })} />
            <Text label="Date of Birth" type="date" value={form.dateOfBirth ?? ""} onChange={(dateOfBirth) => setForm({ ...form, dateOfBirth })} />
            <Text label="Email" type="email" value={form.email ?? ""} onChange={(email) => setForm({ ...form, email })} />
            <Text label="Phone" value={form.phone ?? ""} onChange={(phone) => setForm({ ...form, phone })} />
            <Text label="Address" value={form.addressLine1 ?? ""} onChange={(addressLine1) => setForm({ ...form, addressLine1 })} />
            <Text label="Address 2" value={form.addressLine2 ?? ""} onChange={(addressLine2) => setForm({ ...form, addressLine2 })} />
            <Text label="City" value={form.city ?? ""} onChange={(city) => setForm({ ...form, city })} />
            <Text label="State" value={form.state ?? ""} onChange={(state) => setForm({ ...form, state })} />
            <Text label="Postal Code" value={form.postalCode ?? ""} onChange={(postalCode) => setForm({ ...form, postalCode })} />
            <Select label="Patient Status" value={form.clientStatus ?? "active"} options={["active","inactive","intake","waitlist","discharged","deceased","archived"]} onChange={(clientStatus) => setForm({ ...form, clientStatus })} />
            <Select label="Registration" value={form.registrationStatus ?? "in_progress"} options={["not_started","in_progress","pending_review","complete","needs_correction","archived"]} onChange={(registrationStatus) => setForm({ ...form, registrationStatus })} />
            <div className="thera-span-2"><button type="button" className="thera-action" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save Demographics"}</button></div>
          </div>
        ) : (
          <div className="thera-definition-grid">
            <Field label="Legal Name" value={[patient.first_name, patient.middle_name, patient.last_name].filter(Boolean).join(" ") || "—"} />
            <Field label="Preferred Name" value={value(patient, "preferred_name") || "—"} />
            <Field label="Date of Birth" value={value(patient, "date_of_birth") || "—"} />
            <Field label="Phone" value={value(patient, "phone") || "—"} />
            <Field label="Email" value={value(patient, "email") || "—"} />
            <Field label="Address" value={[patient.address_line1, patient.address_line2, patient.city, patient.state, patient.postal_code].filter(Boolean).join(", ") || "—"} />
          </div>
        )}
      </section>
      <ContactsSection chart={chart} onChanged={onChanged} />
    </div>
  );
}

function ContactsSection({ chart, onChanged }: { chart: PatientChart; onChanged: () => Promise<void> }) {
  const initial: ContactDraft = { contactName: "", relationship: "", phone: "", email: "", isEmergencyContact: false, isResponsibleParty: false };
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ContactDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function beginEdit(row: Record<string, unknown> & { id: string }) {
    setEditingId(row.id);
    setShowNew(false);
    setForm({
      contactName: String(row.contact_name ?? ""), relationship: String(row.relationship ?? ""), phone: String(row.phone ?? ""), email: String(row.email ?? ""),
      isEmergencyContact: row.is_emergency_contact === true, isResponsibleParty: row.is_responsible_party === true,
    });
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      if (editingId) await updatePatientContact(editingId, form);
      else await addPatientContact(chart.patient.id, form);
      await onChanged();
      setForm(initial); setEditingId(null); setShowNew(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save contact."); }
    finally { setSaving(false); }
  }

  return <section className="thera-card thera-span-2">
    <div className="thera-card-header split"><div><h2>Contacts</h2><p>Emergency contacts and responsible parties.</p></div><button type="button" className="thera-action secondary" onClick={() => { setShowNew(true); setEditingId(null); setForm(initial); }}>+ Add Contact</button></div>
    {error && <div className="thera-state error">{error}</div>}
    {(showNew || editingId) && <div className="thera-form-grid" style={{ marginBottom: 16 }}>
      <Text label="Contact Name" value={form.contactName} onChange={(contactName) => setForm({ ...form, contactName })} />
      <Text label="Relationship" value={form.relationship ?? ""} onChange={(relationship) => setForm({ ...form, relationship })} />
      <Text label="Phone" value={form.phone ?? ""} onChange={(phone) => setForm({ ...form, phone })} />
      <Text label="Email" value={form.email ?? ""} onChange={(email) => setForm({ ...form, email })} />
      <label><input type="checkbox" checked={form.isEmergencyContact === true} onChange={(event) => setForm({ ...form, isEmergencyContact: event.target.checked })} /> Emergency Contact</label>
      <label><input type="checkbox" checked={form.isResponsibleParty === true} onChange={(event) => setForm({ ...form, isResponsibleParty: event.target.checked })} /> Responsible Party</label>
      <div className="thera-span-2 thera-filter-row"><button type="button" className="thera-action" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save Contact"}</button><button type="button" className="thera-action secondary" onClick={() => { setShowNew(false); setEditingId(null); }}>Cancel</button></div>
    </div>}
    {chart.contacts.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Name</th><th>Relationship</th><th>Phone</th><th>Email</th><th>Role</th><th>Action</th></tr></thead><tbody>{chart.contacts.map((row) => <tr key={row.id}><td>{String(row.contact_name ?? "—")}</td><td>{String(row.relationship ?? "—")}</td><td>{String(row.phone ?? "—")}</td><td>{String(row.email ?? "—")}</td><td>{[row.is_emergency_contact ? "Emergency" : "", row.is_responsible_party ? "Responsible Party" : ""].filter(Boolean).join(" · ") || "—"}</td><td><button type="button" className="thera-action secondary" onClick={() => beginEdit(row)}>Edit</button></td></tr>)}</tbody></table></div> : <div className="thera-empty">No contacts on file.</div>}
  </section>;
}

function Text({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="thera-field"><span className="thera-field-label">{label}</span><input className="thera-input" type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="thera-field"><span className="thera-field-label">{label}</span><select className="thera-input" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</select></label>;
}
function Field({ label, value }: { label: string; value: unknown }) { return <div><div className="thera-field-label">{label}</div><div>{String(value)}</div></div>; }
