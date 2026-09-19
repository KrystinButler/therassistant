import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { WorkDrawer } from "../../components/work-drawer";
import { dateTime, shortDate } from "../../lib/format";
import {
  tenantRpc,
  tenantSelect,
  tenantUpdate,
  type Row,
} from "../../lib/tenant-data-client";

type DataRow = Row & { id: string };

type ClinicalNote = DataRow & {
  appointment_id?: string | null;
  client_id?: string | null;
  provider_id?: string | null;
  note_type?: string | null;
  note_status?: string | null;
  service_date?: string | null;
  cpt_code?: string | null;
  diagnosis_code?: string | null;
  goal_addressed?: string | null;
  note_text?: string | null;
};

type Appointment = DataRow & {
  client_id?: string | null;
  provider_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  appointment_status?: string | null;
  location_type?: string | null;
  service_type?: string | null;
  cpt_code?: string | null;
};

type EditorState = {
  noteId: string | null;
  appointmentId: string;
  noteType: string;
  noteText: string;
  diagnosisCode: string;
  goalAddressed: string;
  cptCode: string;
  chargeAmount: string;
  placeOfService: string;
};

const NOTE_TYPES = [
  ["psychotherapy", "Psychotherapy"],
  ["assessment", "Assessment"],
  ["intake", "Intake"],
  ["treatment_plan", "Treatment Plan"],
  ["treatment_plan_review", "Treatment Plan Review"],
  ["crisis", "Crisis"],
  ["case_management", "Case Management"],
  ["group", "Group"],
  ["collateral", "Collateral"],
  ["peer_support", "Peer Support"],
  ["medication_management", "Medication Management"],
  ["administrative", "Administrative"],
  ["other", "Other"],
] as const;

function personName(row?: DataRow | null) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function dollarsToCents(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function blankEditor(appointment: Appointment, note?: ClinicalNote | null): EditorState {
  return {
    noteId: note?.id ?? null,
    appointmentId: appointment.id,
    noteType: String(note?.note_type ?? "psychotherapy"),
    noteText: String(note?.note_text ?? ""),
    diagnosisCode: String(note?.diagnosis_code ?? ""),
    goalAddressed: String(note?.goal_addressed ?? ""),
    cptCode: String(note?.cpt_code ?? appointment.cpt_code ?? ""),
    chargeAmount: "",
    placeOfService: appointment.location_type === "telehealth" ? "10" : "11",
  };
}

export function ClinicalPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [notes, setNotes] = useState<ClinicalNote[]>([]);
  const [clients, setClients] = useState<DataRow[]>([]);
  const [providers, setProviders] = useState<DataRow[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [baseline, setBaseline] = useState<EditorState | null>(null);
  const [filter, setFilter] = useState<"needs_note" | "drafts" | "signed" | "all">("needs_note");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [appointmentRows, noteRows, clientRows, providerRows] = await Promise.all([
        tenantSelect<Appointment>("appointments", { order: "starts_at.desc" }),
        tenantSelect<ClinicalNote>("clinical_notes", { order: "service_date.desc,created_at.desc" }),
        tenantSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
        tenantSelect<DataRow>("providers", { order: "last_name.asc,first_name.asc" }),
      ]);
      setAppointments(appointmentRows);
      setNotes(noteRows);
      setClients(clientRows);
      setProviders(providerRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load clinical work.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const clientsById = useMemo(() => new Map(clients.map((row) => [row.id, row])), [clients]);
  const providersById = useMemo(() => new Map(providers.map((row) => [row.id, row])), [providers]);
  const notesByAppointment = useMemo(() => {
    const map = new Map<string, ClinicalNote>();
    for (const note of notes) {
      const appointmentId = String(note.appointment_id ?? "");
      if (appointmentId && !map.has(appointmentId)) map.set(appointmentId, note);
    }
    return map;
  }, [notes]);

  const workRows = useMemo(() => {
    const now = new Date();
    return appointments
      .filter((appointment) => !["cancelled", "no_show", "late_cancel"].includes(String(appointment.appointment_status ?? "")))
      .filter((appointment) => new Date(String(appointment.starts_at ?? "")) <= now || notesByAppointment.has(appointment.id))
      .map((appointment) => ({ appointment, note: notesByAppointment.get(appointment.id) ?? null }))
      .filter(({ note }) => {
        const status = String(note?.note_status ?? "");
        if (filter === "needs_note") return !note;
        if (filter === "drafts") return Boolean(note) && !["signed", "locked", "amended", "voided"].includes(status);
        if (filter === "signed") return ["signed", "locked", "amended"].includes(status);
        return true;
      });
  }, [appointments, notesByAppointment, filter]);

  const counts = useMemo(() => {
    let needsNote = 0;
    let drafts = 0;
    let signed = 0;
    for (const appointment of appointments) {
      const note = notesByAppointment.get(appointment.id);
      const status = String(note?.note_status ?? "");
      if (!note) needsNote += 1;
      else if (["signed", "locked", "amended"].includes(status)) signed += 1;
      else if (status !== "voided") drafts += 1;
    }
    return { needsNote, drafts, signed };
  }, [appointments, notesByAppointment]);

  const dirty = Boolean(editor && baseline && JSON.stringify(editor) !== JSON.stringify(baseline));

  function openEditor(appointment: Appointment, note?: ClinicalNote | null) {
    const next = blankEditor(appointment, note);
    setEditor(next);
    setBaseline({ ...next });
    setError(null);
    setMessage(null);
  }

  function closeEditor() {
    setEditor(null);
    setBaseline(null);
  }

  async function saveDraft() {
    if (!editor) return null;
    if (!editor.noteText.trim()) throw new Error("Enter the clinical note before saving.");
    if (!editor.diagnosisCode.trim()) throw new Error("Diagnosis code is required.");
    if (editor.noteType === "psychotherapy" && !editor.goalAddressed.trim()) {
      throw new Error("Psychotherapy notes require a goal addressed.");
    }

    const appointment = appointments.find((row) => row.id === editor.appointmentId);
    if (!appointment) throw new Error("Appointment not found.");

    if (editor.noteId) {
      await tenantUpdate("clinical_notes", editor.noteId, {
        note_type: editor.noteType,
        note_text: editor.noteText.trim(),
        diagnosis_code: editor.diagnosisCode.trim(),
        goal_addressed: editor.goalAddressed.trim() || null,
        cpt_code: editor.cptCode.trim() || null,
        note_status: "ready_for_signature",
      });
      return editor.noteId;
    }

    const noteId = await tenantRpc<string>("create_clinical_note_for_appointment", {
      p_appointment_id: editor.appointmentId,
      p_note_type: editor.noteType,
      p_note_text: editor.noteText.trim(),
      p_diagnosis_code: editor.diagnosisCode.trim(),
      p_goal_addressed: editor.goalAddressed.trim() || null,
      p_treatment_plan_id: null,
      p_start_time: appointment.starts_at ?? null,
      p_end_time: appointment.ends_at ?? null,
      p_cpt_code: editor.cptCode.trim() || null,
    });

    await tenantUpdate("clinical_notes", noteId, { note_status: "ready_for_signature" });
    setEditor((current) => current ? { ...current, noteId } : current);
    return noteId;
  }

  async function runSave() {
    if (!editor) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const noteId = await saveDraft();
      setMessage("Clinical note saved and ready for signature.");
      await load();
      if (noteId) {
        const refreshed = notes.find((row) => row.id === noteId);
        setBaseline({ ...editor, noteId });
        if (refreshed) setEditor(blankEditor(
          appointments.find((row) => row.id === editor.appointmentId) ?? appointments[0],
          refreshed,
        ));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save clinical note.");
    } finally {
      setSaving(false);
    }
  }

  async function runSign() {
    if (!editor) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const noteId = await saveDraft();
      if (!noteId) throw new Error("Clinical note could not be created.");
      const chargeId = await tenantRpc<string | null>("sign_clinical_note", {
        p_clinical_note_id: noteId,
        p_signature_text: "Electronically signed in Therassistant",
        p_create_charge: true,
        p_charge_amount_cents: dollarsToCents(editor.chargeAmount),
        p_place_of_service: editor.placeOfService.trim() || null,
      });
      setMessage(chargeId
        ? "Clinical note signed and locked. Charge created for Billing."
        : "Clinical note signed and locked.");
      closeEditor();
      await load();
      setFilter("signed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign clinical note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">CLINICAL WORKFLOW</div>
          <h1>Clinical</h1>
          <p>Complete documentation, sign the note, and move the encounter directly into charge capture.</p>
        </div>
      </div>

      <div className="thera-metric-grid" style={{ marginBottom: 16 }}>
        <Metric label="Needs Note" value={counts.needsNote} />
        <Metric label="Draft / Ready" value={counts.drafts} />
        <Metric label="Signed" value={counts.signed} />
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="thera-tabs" style={{ marginBottom: 16 }}>
        <Tab active={filter === "needs_note"} label={`Needs Note (${counts.needsNote})`} onClick={() => setFilter("needs_note")} />
        <Tab active={filter === "drafts"} label={`Draft / Ready (${counts.drafts})`} onClick={() => setFilter("drafts")} />
        <Tab active={filter === "signed"} label={`Signed (${counts.signed})`} onClick={() => setFilter("signed")} />
        <Tab active={filter === "all"} label="All" onClick={() => setFilter("all")} />
      </div>

      <section className="thera-card">
        {loading ? <div className="thera-state">Loading clinical work...</div> : workRows.length === 0 ? (
          <div className="thera-empty">No clinical records in this queue.</div>
        ) : (
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr><th>Service</th><th>Patient</th><th>Provider</th><th>Type</th><th>CPT</th><th>Note</th><th>Action</th></tr>
              </thead>
              <tbody>
                {workRows.map(({ appointment, note }) => {
                  const client = clientsById.get(String(appointment.client_id ?? ""));
                  const provider = providersById.get(String(appointment.provider_id ?? ""));
                  const signed = ["signed", "locked", "amended"].includes(String(note?.note_status ?? ""));
                  return (
                    <tr key={appointment.id}>
                      <td>{dateTime(String(appointment.starts_at ?? ""))}</td>
                      <td>{personName(client)}</td>
                      <td>{personName(provider)}</td>
                      <td>{String(appointment.service_type ?? "Appointment")}</td>
                      <td>{String(note?.cpt_code ?? appointment.cpt_code ?? "—")}</td>
                      <td>{note ? <StatusBadge value={String(note.note_status ?? "draft")} /> : <StatusBadge value="missing" />}</td>
                      <td>
                        <button
                          type="button"
                          className={signed ? "thera-action secondary" : "thera-action"}
                          disabled={signed}
                          onClick={() => openEditor(appointment, note)}
                        >
                          {signed ? "Signed" : note ? "Continue Note" : "Start Note"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editor && (
        <WorkDrawer
          open={Boolean(editor)}
          onOpenChange={(open) => { if (!open) closeEditor(); }}
          dirty={dirty}
          title={editor.noteId ? "Clinical Note" : "New Clinical Note"}
          subtitle={(() => {
            const appointment = appointments.find((row) => row.id === editor.appointmentId);
            const client = appointment ? clientsById.get(String(appointment.client_id ?? "")) : null;
            return appointment ? `${personName(client)} · ${shortDate(String(appointment.starts_at ?? ""))}` : "Clinical documentation";
          })()}
          footer={
            <div className="thera-filter-row" style={{ justifyContent: "space-between", width: "100%" }}>
              <button type="button" className="thera-action secondary" onClick={closeEditor}>Cancel</button>
              <div className="thera-filter-row">
                <button type="button" className="thera-action secondary" disabled={saving} onClick={() => void runSave()}>
                  {saving ? "Saving..." : "Save Draft"}
                </button>
                <button type="button" className="thera-action" disabled={saving} onClick={() => void runSign()}>
                  {saving ? "Signing..." : "Sign & Create Charge"}
                </button>
              </div>
            </div>
          }
        >
          <div className="thera-stack">
            <section className="thera-card">
              <div className="thera-form-grid">
                <label className="thera-field">
                  <span className="thera-field-label">Note Type</span>
                  <select className="thera-input" value={editor.noteType} onChange={(e) => setEditor({ ...editor, noteType: e.target.value })}>
                    {NOTE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="thera-field">
                  <span className="thera-field-label">CPT / HCPCS</span>
                  <input className="thera-input" value={editor.cptCode} onChange={(e) => setEditor({ ...editor, cptCode: e.target.value })} />
                </label>
                <label className="thera-field">
                  <span className="thera-field-label">Diagnosis Code *</span>
                  <input className="thera-input" value={editor.diagnosisCode} onChange={(e) => setEditor({ ...editor, diagnosisCode: e.target.value })} placeholder="F41.1" />
                </label>
                <label className="thera-field">
                  <span className="thera-field-label">Goal Addressed{editor.noteType === "psychotherapy" ? " *" : ""}</span>
                  <input className="thera-input" value={editor.goalAddressed} onChange={(e) => setEditor({ ...editor, goalAddressed: e.target.value })} />
                </label>
              </div>
            </section>

            <section className="thera-card">
              <label className="thera-field">
                <span className="thera-field-label">Clinical Note *</span>
                <textarea className="thera-input" rows={14} value={editor.noteText} onChange={(e) => setEditor({ ...editor, noteText: e.target.value })} placeholder="Document the service, interventions, response, progress, and plan." />
              </label>
            </section>

            <section className="thera-card">
              <div className="thera-card-header"><div><h2>Charge Creation</h2><p>Used when the note is signed.</p></div></div>
              <div className="thera-form-grid">
                <label className="thera-field">
                  <span className="thera-field-label">Charge Amount</span>
                  <input className="thera-input" inputMode="decimal" value={editor.chargeAmount} onChange={(e) => setEditor({ ...editor, chargeAmount: e.target.value })} placeholder="0.00" />
                </label>
                <label className="thera-field">
                  <span className="thera-field-label">Place of Service</span>
                  <input className="thera-input" value={editor.placeOfService} onChange={(e) => setEditor({ ...editor, placeOfService: e.target.value })} placeholder="10" />
                </label>
              </div>
            </section>
          </div>
        </WorkDrawer>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="thera-metric-card"><div className="thera-metric-label">{label}</div><div className="thera-metric-value">{value}</div></div>;
}

function Tab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" className={active ? "thera-tab active" : "thera-tab"} onClick={onClick}>{label}</button>;
}
