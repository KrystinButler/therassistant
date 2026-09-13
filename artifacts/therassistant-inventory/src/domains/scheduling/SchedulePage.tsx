import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime } from "../../lib/format";
import {
  createAppointment,
  getScheduleData,
  updateAppointmentStatus,
  type ScheduleData,
} from "./repository";

type ViewMode = "day" | "week" | "month";

type FormState = {
  clientId: string;
  providerId: string;
  date: string;
  time: string;
  durationMinutes: number;
  locationType: "in_person" | "telehealth" | "phone" | "community" | "home" | "school" | "other";
  serviceType: string;
  cptCode: string;
};

const initialForm: FormState = {
  clientId: "",
  providerId: "",
  date: "",
  time: "09:00",
  durationMinutes: 60,
  locationType: "telehealth",
  serviceType: "Individual Therapy",
  cptCode: "90837",
};

function personName(row: Record<string, unknown>) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed";
}

function startOfWeek(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - value.getDay());
  return value;
}

function inView(dateText: string, anchor: Date, view: ViewMode) {
  const value = new Date(dateText);
  if (Number.isNaN(value.getTime())) return false;

  if (view === "day") {
    return value.toDateString() === anchor.toDateString();
  }

  if (view === "week") {
    const start = startOfWeek(anchor);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return value >= start && value < end;
  }

  return (
    value.getFullYear() === anchor.getFullYear() &&
    value.getMonth() === anchor.getMonth()
  );
}

function rangeLabel(anchor: Date, view: ViewMode) {
  if (view === "day") {
    return anchor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  if (view === "week") {
    const start = startOfWeek(anchor);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function SchedulePage() {
  const [data, setData] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [providerFilter, setProviderFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getScheduleData());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load schedule.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(() => {
    if (!data) return [];
    return data.appointments.filter(
      (appointment) =>
        inView(appointment.startsAt, anchor, view) &&
        (!providerFilter || appointment.providerId === providerFilter) &&
        (!statusFilter || appointment.appointmentStatus === statusFilter),
    );
  }, [data, anchor, view, providerFilter, statusFilter]);

  function move(direction: -1 | 1) {
    setAnchor((current) => {
      const next = new Date(current);
      if (view === "day") next.setDate(next.getDate() + direction);
      if (view === "week") next.setDate(next.getDate() + direction * 7);
      if (view === "month") next.setMonth(next.getMonth() + direction);
      return next;
    });
  }

  async function changeStatus(id: string, status: string) {
    try {
      await updateAppointmentStatus(id, status);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update appointment.");
    }
  }

  async function saveAppointment() {
    setSaving(true);
    setError(null);
    try {
      await createAppointment(form);
      setShowNew(false);
      setForm(initialForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to schedule appointment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">CLINICAL OPERATIONS</div>
          <h1>Schedule</h1>
          <p>Appointments connected to patient coverage, authorization, provider participation, and encounter readiness.</p>
        </div>
        <button type="button" className="thera-action" onClick={() => setShowNew(true)}>
          + New Appointment
        </button>
      </div>

      <section className="thera-card" style={{ marginBottom: 16 }}>
        <div className="thera-card-header">
          <div>
            <h2>{rangeLabel(anchor, view)}</h2>
            <p>{visible.length} appointment{visible.length === 1 ? "" : "s"} in this view</p>
          </div>
          <div className="thera-filter-row">
            <button type="button" className="thera-action secondary" onClick={() => move(-1)}>Previous</button>
            <button type="button" className="thera-action secondary" onClick={() => setAnchor(new Date())}>Today</button>
            <button type="button" className="thera-action secondary" onClick={() => move(1)}>Next</button>
          </div>
        </div>

        <div className="thera-filter-row" style={{ marginBottom: 12 }}>
          {(["day", "week", "month"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={view === mode ? "thera-action" : "thera-action secondary"}
              onClick={() => setView(mode)}
            >
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
          <select className="thera-input" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
            <option value="">All providers</option>
            {(data?.providers ?? []).map((provider) => (
              <option key={provider.id} value={provider.id}>{personName(provider)}</option>
            ))}
          </select>
          <select className="thera-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All statuses</option>
            {[
              "scheduled",
              "confirmed",
              "client_arrived",
              "checked_in",
              "in_session",
              "completed",
              "cancelled",
              "no_show",
              "late_cancel",
              "rescheduled",
            ].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
          </select>
        </div>
      </section>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {loading && <div className="thera-state">Loading schedule...</div>}

      {!loading && data && (
        <section className="thera-card">
          {visible.length === 0 ? (
            <div className="thera-empty">No appointments in this view. Use New Appointment to schedule one.</div>
          ) : (
            <div className="thera-table-wrap">
              <table className="thera-table">
                <thead>
                  <tr>
                    <th>Date / Time</th>
                    <th>Patient</th>
                    <th>Provider</th>
                    <th>Service</th>
                    <th>Payer</th>
                    <th>Readiness</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((appointment) => (
                    <tr key={appointment.id}>
                      <td>{dateTime(appointment.startsAt)}</td>
                      <td>
                        <Link className="thera-table-link" href={`/clients/${appointment.clientId}`}>{appointment.clientName}</Link>
                        <div className="thera-table-subtext">Registration: {appointment.registrationStatus.replaceAll("_", " ")}</div>
                      </td>
                      <td>{appointment.providerName}</td>
                      <td>{appointment.serviceType || "—"}<div className="thera-table-subtext">{appointment.cptCode || "No CPT"} · {appointment.locationType.replaceAll("_", " ")}</div></td>
                      <td>{appointment.payerName}<div className="thera-table-subtext">{appointment.planName}</div></td>
                      <td>
                        <StatusBadge value={appointment.readiness.ready ? "ready" : "blocked"} />
                        {!appointment.readiness.ready && <div className="thera-table-subtext">{appointment.readiness.checks.filter((check) => check.blocking).length} blocking issue(s)</div>}
                      </td>
                      <td><StatusBadge value={appointment.appointmentStatus} /></td>
                      <td>
                        <div className="thera-filter-row">
                          <Link className="thera-action secondary" href={`/schedule/${appointment.id}`}>Pre-Session</Link>
                          {appointment.appointmentStatus === "scheduled" && (
                            <button type="button" className="thera-action secondary" onClick={() => void changeStatus(appointment.id, "confirmed")}>Confirm</button>
                          )}
                          {["scheduled", "confirmed", "client_arrived"].includes(appointment.appointmentStatus) && (
                            <button type="button" className="thera-action secondary" onClick={() => void changeStatus(appointment.id, "checked_in")}>Check In</button>
                          )}
                          {!['completed','cancelled','no_show','late_cancel'].includes(appointment.appointmentStatus) && (
                            <button type="button" className="thera-action secondary" onClick={() => void changeStatus(appointment.id, "no_show")}>No Show</button>
                          )}
                          {!['completed','cancelled','no_show'].includes(appointment.appointmentStatus) && (
                            <button type="button" className="thera-action secondary" onClick={() => void changeStatus(appointment.id, "cancelled")}>Cancel</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {showNew && data && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", padding: 20 }}>
          <section className="thera-card" style={{ width: "min(760px, 100%)", maxHeight: "90vh", overflow: "auto" }}>
            <div className="thera-card-header">
              <div><h2>New Appointment</h2><p>Select records by name. Coverage context is derived from the patient chart.</p></div>
              <button type="button" className="thera-action secondary" onClick={() => setShowNew(false)}>Close</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
              <label><div className="thera-field-label">Patient</div><select className="thera-input" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Select patient</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{personName(client)}</option>)}</select></label>
              <label><div className="thera-field-label">Provider</div><select className="thera-input" value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })}><option value="">Select provider</option>{data.providers.map((provider) => <option key={provider.id} value={provider.id}>{personName(provider)}{provider.credentials ? `, ${provider.credentials}` : ""}</option>)}</select></label>
              <label><div className="thera-field-label">Date</div><input className="thera-input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
              <label><div className="thera-field-label">Time</div><input className="thera-input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
              <label><div className="thera-field-label">Duration</div><select className="thera-input" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option><option value={90}>90 minutes</option></select></label>
              <label><div className="thera-field-label">Location</div><select className="thera-input" value={form.locationType} onChange={(e) => setForm({ ...form, locationType: e.target.value as FormState["locationType"] })}><option value="telehealth">Telehealth</option><option value="in_person">In Person</option><option value="phone">Phone</option><option value="community">Community</option><option value="home">Home</option><option value="school">School</option><option value="other">Other</option></select></label>
              <label><div className="thera-field-label">Service</div><input className="thera-input" value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} /></label>
              <label><div className="thera-field-label">CPT / HCPCS</div><input className="thera-input" value={form.cptCode} onChange={(e) => setForm({ ...form, cptCode: e.target.value })} /></label>
            </div>
            <div style={{ marginTop: 16 }}>
              <button type="button" className="thera-action" disabled={saving} onClick={() => void saveAppointment()}>{saving ? "Saving..." : "Schedule Appointment"}</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
