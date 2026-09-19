import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime } from "../../lib/format";
import { tenantSelect, type Row } from "../../lib/tenant-data-client";
import { startEncounter } from "../encounters/repository";

type DataRow = Row & { id: string };

type Appointment = DataRow & {
  client_id?: string | null;
  provider_id?: string | null;
  starts_at?: string | null;
  appointment_status?: string | null;
  service_type?: string | null;
  cpt_code?: string | null;
};

type Encounter = DataRow & {
  appointment_id?: string | null;
  encounter_status?: string | null;
  billing_status?: string | null;
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
    return appointments
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
  }, [appointments, encounterByAppointment, latestNoteByEncounter]);

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
      navigate(`/encounters/${encounter.id}`);
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
      navigate(`/encounters/${result.value.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start encounter.");
    } finally {
      setStartingId(null);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">CLINICAL WORKFLOW</div>
          <h1>Clinical</h1>
          <p>One queue for starting, completing, and signing encounter documentation before billing.</p>
        </div>
      </div>

      <div className="thera-metric-grid" style={{ marginBottom: 16 }}>
        <Metric label="Needs Note" value={counts.needsNote} />
        <Metric label="In Progress" value={counts.inProgress} />
        <Metric label="Signed" value={counts.signed} />
      </div>

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
