import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import "./clinical-page.css";

import { StatusBadge } from "../../components/status-badge";
import { dateTime } from "../../lib/format";
import { tenantSelect, type Row } from "../../lib/tenant-data-client";
import { createUnscheduledEncounter, startEncounter } from "../encounters/repository";

type DataRow = Row & { id: string };

type Appointment = DataRow & {
  client_id?: string | null;
  provider_id?: string | null;
  starts_at?: string | null;
  appointment_status?: string | null;
  service_type?: string | null;
  cpt_code?: string | null;
  ends_at?: string | null;
};

type Encounter = DataRow & {
  appointment_id?: string | null;
  encounter_status?: string | null;
  billing_status?: string | null;
  client_id?: string | null;
  provider_id?: string | null;
  started_at?: string | null;
  service_type?: string | null;
};

type ClinicalNote = DataRow & {
  encounter_id?: string | null;
  note_status?: string | null;
};

type QueueTab = "needs_note" | "in_progress" | "signed" | "all";

function personName(row?: DataRow | null) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function todayForForm(): string {
  const today = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

const serviceTypes = [
  "Psychotherapy", "Assessment", "Intake", "Crisis", "Case Management", "Medication Management", "Other",
] as const;

function isCancelled(status: string) {
  return ["cancelled", "no_show", "late_cancel", "rescheduled"].includes(status);
}

export function ClinicalPage() {
  const [, navigate] = useLocation();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [notes, setNotes] = useState<ClinicalNote[]>([]);
  const [clients, setClients] = useState<DataRow[]>([]);
  const [providers, setProviders] = useState<DataRow[]>([]);
  const [tab, setTab] = useState<QueueTab>("needs_note");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createClientId, setCreateClientId] = useState("");
  const [createProviderId, setCreateProviderId] = useState("");
  const [createVisitId, setCreateVisitId] = useState("");
  const [createService, setCreateService] = useState("Psychotherapy");
  const [createDate, setCreateDate] = useState(todayForForm);
  const [createLocation, setCreateLocation] = useState("telehealth");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [appointmentRows, encounterRows, noteRows, clientRows, providerRows] = await Promise.all([
        tenantSelect<Appointment>("appointments", { order: "starts_at.desc" }),
        tenantSelect<Encounter>("encounters", { order: "updated_at.desc" }),
        tenantSelect<ClinicalNote>("clinical_notes", { order: "created_at.desc" }),
        tenantSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
        tenantSelect<DataRow>("providers", { order: "last_name.asc,first_name.asc" }),
      ]);
      setAppointments(appointmentRows);
      setEncounters(encounterRows);
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
  const encounterByAppointment = useMemo(
    () => new Map(
      encounters
        .filter((row) => row.appointment_id)
        .map((row) => [String(row.appointment_id), row]),
    ),
    [encounters],
  );
  const latestNoteByEncounter = useMemo(() => {
    const map = new Map<string, ClinicalNote>();
    for (const note of notes) {
      const encounterId = String(note.encounter_id ?? "");
      if (encounterId && !map.has(encounterId)) map.set(encounterId, note);
    }
    return map;
  }, [notes]);

  const rows = useMemo(() => {
    const now = new Date();
    const scheduled = appointments
      .filter((appointment) => {
        const status = String(appointment.appointment_status ?? "scheduled");
        if (isCancelled(status)) return false;
        const started = new Date(String(appointment.starts_at ?? ""));
        return started <= now || encounterByAppointment.has(appointment.id);
      })
      .map((appointment) => {
        const encounter = encounterByAppointment.get(appointment.id) ?? null;
        const note = encounter ? latestNoteByEncounter.get(encounter.id) ?? null : null;
        const noteStatus = String(note?.note_status ?? "");
        const signed = ["signed", "locked", "amended"].includes(noteStatus);
        const inProgress = Boolean(encounter) && !signed;
        return { appointment, encounter, note, signed, inProgress };
      });
    // Direct chart documentation has no fabricated appointment. Keep it visible
    // in the same clinical workqueue after the editor is closed or reopened.
    const direct = encounters
      .filter((encounter) => !encounter.appointment_id && encounter.encounter_status !== "voided")
      .map((encounter) => {
        const appointment: Appointment = {
          id: "direct:" + encounter.id,
          client_id: String(encounter.client_id ?? ""),
          provider_id: encounter.provider_id ? String(encounter.provider_id) : null,
          starts_at: String(encounter.started_at ?? ""),
          service_type: String(encounter.service_type ?? "Clinical documentation"),
          appointment_status: "in_session",
        };
        const note = latestNoteByEncounter.get(encounter.id) ?? null;
        const signed = ["signed", "locked", "amended"].includes(String(note?.note_status ?? ""));
        return { appointment, encounter, note, signed, inProgress: !signed };
      });
    return [...scheduled, ...direct].sort((a, b) =>
      String(b.appointment.starts_at ?? "").localeCompare(String(a.appointment.starts_at ?? "")));
  }, [appointments, encounters, encounterByAppointment, latestNoteByEncounter]);

  const counts = useMemo(() => ({
    needsNote: rows.filter((row) => !row.encounter).length,
    inProgress: rows.filter((row) => row.inProgress).length,
    signed: rows.filter((row) => row.signed).length,
  }), [rows]);

  const visible = rows.filter((row) => {
    if (tab === "needs_note") return !row.encounter;
    if (tab === "in_progress") return row.inProgress;
    if (tab === "signed") return row.signed;
    return true;
  });

  async function openClinicalWork(appointment: Appointment, encounter: Encounter | null) {
    if (encounter) {
      navigate(`/encounters/${encounter.id}#encounter-progress-note-editor`);
      return;
    }

    setStartingId(appointment.id);
    setError(null);
    try {
      const result = await startEncounter(appointment.id);
      if (!result.ok) {
        setError(
          result.details?.length
            ? `${result.message} ${result.details.join(" ")}`
            : result.message,
        );
        return;
      }
      navigate(`/encounters/${result.value.id}#encounter-progress-note-editor`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start encounter.");
    } finally {
      setStartingId(null);
    }
  }

  const selectedVisit = appointments.find((row) => row.id === createVisitId) ?? null;
  const documentedVisitIds = new Set(encounters.filter((row) => row.appointment_id &&
    ["signed", "locked", "amended"].includes(String(latestNoteByEncounter.get(row.id)?.note_status ?? "")))
    .map((row) => String(row.appointment_id)));
  const availableVisits = appointments.filter((row) =>
    String(row.client_id ?? "") === createClientId &&
    !isCancelled(String(row.appointment_status ?? "")) &&
    new Date(String(row.starts_at ?? "")).getTime() <= Date.now() &&
    !documentedVisitIds.has(row.id));

  function resetCreate() {
    setCreateOpen(false);
    setCreateError(null);
    setCreateClientId("");
    setCreateProviderId("");
    setCreateVisitId("");
    setCreateService("Psychotherapy");
    setCreateDate(todayForForm());
    setCreateLocation("telehealth");
  }

  async function createDocumentation() {
    if (creating) return;
    if (!createClientId) { setCreateError("Select a patient."); return; }
    if (!selectedVisit && !createProviderId) { setCreateError("Select the rendering provider."); return; }
    setCreating(true);
    setCreateError(null);
    try {
      if (selectedVisit) {
        const existing = encounterByAppointment.get(selectedVisit.id);
        if (existing) {
          navigate(`/encounters/${existing.id}#encounter-progress-note-editor`);
          return;
        }
        const result = await startEncounter(selectedVisit.id);
        if (!result.ok) {
          setCreateError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
          return;
        }
        navigate(`/encounters/${result.value.id}#encounter-progress-note-editor`);
      } else {
        const encounter = await createUnscheduledEncounter({
          clientId: createClientId,
          providerId: createProviderId,
          serviceType: createService,
          serviceDate: createDate,
          locationType: createLocation,
        });
        navigate(`/encounters/${encounter.id}#encounter-progress-note-editor`);
      }
      resetCreate();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unable to open clinical documentation.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">DOCUMENT · CLINICAL WORKFLOW</div>
          <h1>Clinical Documentation</h1>
          <p>Start a new clinical note or continue an existing encounter. Scheduled and unscheduled visits use the same note editor.</p>
        </div>
        <button type="button" className="thera-action" disabled={loading} onClick={() => setCreateOpen(true)}>+ Create Documentation</button>
      </div>

      <div className="thera-metric-grid" style={{ marginBottom: 16 }}>
        <Metric label="Needs Note" value={counts.needsNote} />
        <Metric label="In Progress" value={counts.inProgress} />
        <Metric label="Signed" value={counts.signed} />
      </div>

      {!loading && !rows.length && <section className="thera-card" style={{ borderLeft: "4px solid var(--thera-sage)", marginBottom: 14 }}>
        <h2>No clinical notes yet</h2><p>Choose a patient and start documentation without creating a billing charge or an artificial appointment.</p>
        <button type="button" className="thera-action" onClick={() => setCreateOpen(true)}>Create Documentation</button>
      </section>}
      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="thera-tabs" style={{ marginBottom: 16 }}>
        <Tab active={tab === "needs_note"} label={`Needs Note (${counts.needsNote})`} onClick={() => setTab("needs_note")} />
        <Tab active={tab === "in_progress"} label={`In Progress (${counts.inProgress})`} onClick={() => setTab("in_progress")} />
        <Tab active={tab === "signed"} label={`Signed (${counts.signed})`} onClick={() => setTab("signed")} />
        <Tab active={tab === "all"} label="All" onClick={() => setTab("all")} />
      </div>

      <section className="thera-card">
        {loading ? (
          <div className="thera-state">Loading clinical work...</div>
        ) : visible.length === 0 ? (
          <div className="thera-empty">No clinical records in this queue.</div>
        ) : (
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Patient</th>
                  <th>Provider</th>
                  <th>Visit</th>
                  <th>CPT</th>
                  <th>Encounter</th>
                  <th>Note</th>
                  <th>Billing</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ appointment, encounter, note, signed }) => {
                  const client = clientsById.get(String(appointment.client_id ?? ""));
                  const provider = providersById.get(String(appointment.provider_id ?? ""));
                  return (
                    <tr key={appointment.id}>
                      <td>{dateTime(String(appointment.starts_at ?? ""))}</td>
                      <td>{personName(client)}</td>
                      <td>{personName(provider)}</td>
                      <td>{String(appointment.service_type ?? "Appointment")}</td>
                      <td>{String(appointment.cpt_code ?? "—")}</td>
                      <td><StatusBadge value={String(encounter?.encounter_status ?? "not_started")} /></td>
                      <td><StatusBadge value={String(note?.note_status ?? "missing")} /></td>
                      <td><StatusBadge value={String(encounter?.billing_status ?? "not_ready")} /></td>
                      <td>
                        <button
                          type="button"
                          className={signed ? "thera-action secondary" : "thera-action"}
                          disabled={startingId === appointment.id}
                          onClick={() => void openClinicalWork(appointment, encounter)}
                        >
                          {startingId === appointment.id
                            ? "Starting..."
                            : encounter
                              ? signed
                                ? "Open Signed Encounter"
                                : "Continue Note"
                              : "Start Note"}
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

      {createOpen && <div className="clinical-create-backdrop">
        <section role="dialog" aria-modal="true" aria-labelledby="clinical-create-title" className="thera-card clinical-create-modal">
          <div className="thera-card-header split">
            <div><div className="thera-eyebrow">NEW CLINICAL DOCUMENTATION</div>
              <h2 id="clinical-create-title">Create Documentation</h2>
              <p>Choose an existing visit or create a chart note for an unscheduled clinical encounter. Signing and billing remain separate.</p></div>
            <button type="button" className="thera-action secondary" disabled={creating} onClick={resetCreate}>Close</button>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void createDocumentation(); }}>
            <div className="clinical-create-grid">
              <label>Patient <select className="thera-input" required value={createClientId} disabled={creating}
                onChange={(event) => { setCreateClientId(event.target.value); setCreateVisitId(""); setCreateError(null); }}>
                <option value="">Select patient</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{personName(client)}</option>)}
              </select></label>
              <label>Link to recorded visit <select className="thera-input" value={createVisitId} disabled={!createClientId || creating}
                onChange={(event) => { setCreateVisitId(event.target.value); setCreateError(null); }}>
                <option value="">No appointment — document a clinical encounter</option>
                {availableVisits.map((appointment) => <option key={appointment.id} value={appointment.id}>
                  {dateTime(String(appointment.starts_at ?? ""))} · {String(appointment.service_type ?? "Visit")} {encounterByAppointment.has(appointment.id) ? "· Continue note" : ""}
                </option>)}
              </select></label>
              <label>Rendering provider <select className="thera-input" required={!selectedVisit} value={selectedVisit ? String(selectedVisit.provider_id ?? "") : createProviderId}
                disabled={Boolean(selectedVisit) || creating} onChange={(event) => { setCreateProviderId(event.target.value); setCreateError(null); }}>
                <option value="">Select provider</option>
                {providers.map((provider) => <option key={provider.id} value={provider.id}>{personName(provider)}{provider.credentials ? ", " + String(provider.credentials) : ""}</option>)}
              </select></label>
              <label>Note type <select className="thera-input" value={selectedVisit ? String(selectedVisit.service_type ?? "Psychotherapy") : createService}
                disabled={Boolean(selectedVisit) || creating} onChange={(event) => setCreateService(event.target.value)}>
                {selectedVisit?.service_type && !serviceTypes.some((type) => type === selectedVisit.service_type) && <option value={String(selectedVisit.service_type)}>{selectedVisit.service_type}</option>}
                {serviceTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select></label>
              <label>Date of service <input className="thera-input" type="date" required value={selectedVisit ? String(selectedVisit.starts_at ?? "").slice(0, 10) : createDate}
                max={todayForForm()} disabled={Boolean(selectedVisit) || creating} onChange={(event) => setCreateDate(event.target.value)} /></label>
              <label>Location <select className="thera-input" value={selectedVisit ? String(selectedVisit.location_type ?? "telehealth") : createLocation}
                disabled={Boolean(selectedVisit) || creating} onChange={(event) => setCreateLocation(event.target.value)}>
                <option value="telehealth">Telehealth</option>
                <option value="office">Office</option>
                <option value="phone">Phone</option>
                <option value="other">Other</option>
              </select></label>
            </div>
            {createClientId && !availableVisits.length && <p className="thera-table-subtext" style={{ marginTop: 11 }}>No eligible recorded visit found for this patient. You can create documentation without a scheduled appointment.</p>}
            {createError && <div className="thera-state error" role="alert" style={{ marginTop: 12 }}>{createError}</div>}
            {!clients.length && <p style={{ marginTop: 12 }}><Link href="/clients" className="thera-link">Add a patient first</Link></p>}
            <div className="thera-filter-row" style={{ marginTop: 16, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="thera-action secondary" onClick={resetCreate} disabled={creating}>Cancel</button>
              <button type="submit" className="thera-action" disabled={creating || !createClientId || (!selectedVisit && !createProviderId)}>
                {creating ? "Opening note…" : selectedVisit && encounterByAppointment.has(selectedVisit.id) ? "Continue Note" : "Open Note Editor"}
              </button>
            </div>
          </form>
        </section>
      </div>}
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="thera-metric-card">
      <div className="thera-metric-label">{label}</div>
      <div className="thera-metric-value">{value}</div>
    </div>
  );
}

function Tab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" className={active ? "thera-tab active" : "thera-tab"} onClick={onClick}>{label}</button>;
}
