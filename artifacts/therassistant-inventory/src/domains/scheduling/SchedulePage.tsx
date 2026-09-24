import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";

import { StatusBadge } from "../../components/status-badge";
import { useAuth } from "../../auth/auth-context";
import { useTenant } from "../../auth/tenant-context";
import { WorkDrawer } from "../../components/work-drawer";
import { updateAppointment } from "./appointment-edit";
import { PatientReviewDrawer } from "./PatientReviewDrawer";
import { createAppointment, getScheduleData, type ScheduleAppointment, type ScheduleData } from "./repository";
import { noteTemplateLabelForService } from "../encounters/service-note-template";
import "./schedule-page.css";
import "./schedule-appointment-drawer.css";

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

const SERVICE_TYPES = [
  { name: "Individual Therapy", code: "90837" },
  { name: "Psychotherapy, 45 minutes", code: "90834" },
  { name: "Psychotherapy, 30 minutes", code: "90832" },
  { name: "Initial Assessment", code: "90791" },
  { name: "Psychiatric Evaluation", code: "90792" },
  { name: "Crisis Psychotherapy", code: "90839" },
  { name: "Family Therapy", code: "90847" },
  { name: "Group Therapy", code: "90853" },
  { name: "Medication Management", code: "99213" },
  { name: "Case Management", code: "" },
] as const;

const initialForm: FormState = {
  clientId: "", providerId: "", date: "", time: "09:00", durationMinutes: 60,
  locationType: "telehealth", serviceType: "Individual Therapy", cptCode: "90837",
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
  if (view === "day") return value.toDateString() === anchor.toDateString();
  if (view === "week") {
    const start = startOfWeek(anchor);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return value >= start && value < end;
  }
  return value.getFullYear() === anchor.getFullYear() && value.getMonth() === anchor.getMonth();
}

function rangeLabel(anchor: Date, view: ViewMode) {
  if (view === "day") return anchor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (view === "week") {
    const start = startOfWeek(anchor);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function appointmentTime(startsAt: string) {
  const value = new Date(startsAt);
  return Number.isFinite(value.getTime()) ? value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—";
}

function formFrom(appointment: ScheduleAppointment): FormState {
  const start = new Date(appointment.startsAt);
  const end = new Date(appointment.endsAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    clientId: appointment.clientId,
    providerId: appointment.providerId ?? "",
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    durationMinutes: Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000)),
    locationType: appointment.locationType as FormState["locationType"],
    serviceType: appointment.serviceType,
    cptCode: appointment.cptCode,
  };
}

function checkInTone(appointment: ScheduleAppointment) {
  if (appointment.checkInStatus === "Ready") return "ready";
  if (appointment.checkInStatus === "In Progress") return "progress";
  if (appointment.checkInStatus === "Balance Issues") return "issue";
  return "waiting";
}

function sessionFocusAction(focus: string | null) {
  const value = (focus ?? "").toLowerCase();
  if (value.includes("review")) return "REVIEW";
  if (value.includes("update")) return "UPDATE";
  if (value.includes("create")) return "CREATE";
  if (value.includes("resolve")) return "RESOLVE";
  return "WORK ON";
}

function compactDate(startsAt: string) {
  const value = new Date(startsAt);
  return Number.isFinite(value.getTime())
    ? value.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : "—";
}

export function SchedulePage() {
  const { user } = useAuth();
  const { roles } = useTenant();
  const [data, setData] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("day");
  const [anchor, setAnchor] = useState(() => new Date());
  const [providerFilter, setProviderFilter] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [baseline, setBaseline] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<ScheduleAppointment | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getScheduleData()); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load schedule."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!data) return;
    const id = new URLSearchParams(window.location.search).get("appointment");
    if (!id) return;
    const appointment = data.appointments.find((row) => row.id === id);
    if (!appointment) return;
    setSelectedAppointment(appointment);
    setAnchor(new Date(appointment.startsAt));
    setView("day");
  }, [data]);

  const clinicianView =
    roles.includes("clinician") &&
    !roles.some((role) => ["platform_admin", "practice_admin", "billing_company_admin", "billing_manager", "front_desk"].includes(role));
  const signedInProvider = useMemo(() => {
    const email = String(user?.email ?? "").trim().toLowerCase();
    if (!data || !email) return null;
    return data.providers.find((provider) => String(provider.email ?? "").trim().toLowerCase() === email) ?? null;
  }, [data, user?.email]);

  useEffect(() => {
    if (!clinicianView || !signedInProvider) return;
    setProviderFilter(signedInProvider.id);
  }, [clinicianView, signedInProvider?.id]);

  const effectiveProviderFilter = clinicianView
    ? signedInProvider?.id ?? "__unlinked_clinician__"
    : providerFilter;

  const visible = useMemo(() => data ? data.appointments.filter((appointment) =>
    inView(appointment.startsAt, anchor, view) && (!effectiveProviderFilter || appointment.providerId === effectiveProviderFilter),
  ) : [], [data, anchor, view, effectiveProviderFilter]);

  const readyCount = visible.filter((appointment) => appointment.checkInStatus === "Ready").length;
  const attentionCount = visible.filter((appointment) => appointment.checkInStatus !== "Ready").length;
  const now = clockNow;
  const currentAppointmentId = view === "day"
    ? visible.find((appointment) => new Date(appointment.startsAt).getTime() <= now && new Date(appointment.endsAt).getTime() > now)?.id ?? null
    : null;
  const nextAppointmentId = view === "day"
    ? visible
        .filter((appointment) => new Date(appointment.startsAt).getTime() > now)
        .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())[0]?.id ?? null
    : null;

  const dirty = useMemo(() => Boolean(form && baseline && JSON.stringify(form) !== JSON.stringify(baseline)), [form, baseline]);

  function move(direction: -1 | 1) {
    setAnchor((current) => {
      const next = new Date(current);
      if (view === "day") next.setDate(next.getDate() + direction);
      if (view === "week") next.setDate(next.getDate() + direction * 7);
      if (view === "month") next.setMonth(next.getMonth() + direction);
      return next;
    });
  }

  function openNew() {
    const selectedDate = new Date(anchor);
    const pad = (value: number) => String(value).padStart(2, "0");
    const next = {
      ...initialForm,
      providerId: clinicianView ? signedInProvider?.id ?? "" : providerFilter,
      date: `${selectedDate.getFullYear()}-${pad(selectedDate.getMonth() + 1)}-${pad(selectedDate.getDate())}`,
    };
    setFormError(null);
    setEditingId(null); setForm(next); setBaseline({ ...next });
  }

  function openEdit(appointment: ScheduleAppointment) {
    const next = formFrom(appointment);
    setSelectedAppointment(null);
    setFormError(null);
    setEditingId(appointment.id); setForm(next); setBaseline({ ...next });
  }

  function closeEditDrawer() { setForm(null); setBaseline(null); setEditingId(null); }

  function openReview(appointment: ScheduleAppointment) {
    setSelectedAppointment(appointment);
    const url = new URL(window.location.href);
    url.searchParams.set("appointment", appointment.id);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  function closeReview() {
    setSelectedAppointment(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("appointment");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  async function saveAppointment() {
    if (!form) return;
    setSaving(true); setFormError(null);
    try {
      if (editingId) await updateAppointment(editingId, form);
      else await createAppointment(form);
      closeEditDrawer();
      await load();
    } catch (err) { setFormError(err instanceof Error ? err.message : "Unable to save appointment."); }
    finally { setSaving(false); }
  }

  return <>
    <div className="schedule-header">
      <div>
        <div className="thera-eyebrow">PREPARE · PROVIDER SCHEDULE</div>
        <h1>My Schedule</h1>
        <p>See who is ready, review the pre-visit signal, and open the patient drawer without leaving the day.</p>
      </div>
      <button type="button" className="thera-action secondary" onClick={openNew}>+ Appointment</button>
    </div>

    <section className="schedule-toolbar">
      <div className="schedule-date-controls">
        <button type="button" aria-label="Previous" onClick={() => move(-1)}>‹</button>
        <div>{rangeLabel(anchor, view)}</div>
        <button type="button" aria-label="Next" onClick={() => move(1)}>›</button>
        <button type="button" className="schedule-today" onClick={() => setAnchor(new Date())}>Today</button>
      </div>
      <div className="schedule-toolbar-right">
        <div className="schedule-view-tabs">{(["day", "week", "month"] as ViewMode[]).map((mode) => <button key={mode} type="button" className={view === mode ? "active" : ""} onClick={() => setView(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</div>
        {clinicianView
          ? <div className={signedInProvider ? "schedule-provider-identity" : "schedule-provider-identity unlinked"}><span>Provider</span><strong>{signedInProvider ? personName(signedInProvider) : "Profile not linked"}</strong></div>
          : <select className="thera-input schedule-provider-filter" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}><option value="">All providers</option>{(data?.providers ?? []).map((provider) => <option key={provider.id} value={provider.id}>{personName(provider)}</option>)}</select>}
      </div>
    </section>

    <div className="schedule-summary" aria-label="Schedule summary">
      <span><CalendarDays size={14} /> {visible.length} appointment{visible.length === 1 ? "" : "s"}</span>
      <span>{readyCount} ready</span>
      <span>{attentionCount} check-in{attentionCount === 1 ? "" : "s"} pending or needing attention</span>
    </div>

    {clinicianView && !signedInProvider && data && <div className="thera-state error" style={{ marginBottom: 12 }}>Your clinician login is not linked to a provider profile. The schedule is hidden until the provider email matches your sign-in email.</div>}
    {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
    {loading && <div className="thera-state">Loading schedule...</div>}

    {!loading && data && <section className="schedule-card">
      {visible.length === 0 ? <div className="thera-empty">No appointments in this view.</div> : <div className="schedule-table-wrap"><table className="schedule-table"><thead><tr><th>Time</th><th>Patient</th><th>Check-In Status</th><th>Pre-Visit Insight</th><th>Session Focus</th><th aria-label="Open" /></tr></thead><tbody>{visible.map((appointment) => {
        const statusTone = checkInTone(appointment);
        const focusAction = sessionFocusAction(appointment.sessionFocus);
        const rowState = appointment.id === currentAppointmentId ? " current" : appointment.id === nextAppointmentId ? " next" : "";
        return <tr
          key={appointment.id}
          className={`schedule-row${rowState}`}
          role="button"
          tabIndex={0}
          aria-label={`Review ${appointment.clientName} appointment at ${appointmentTime(appointment.startsAt)}`}
          onClick={() => openReview(appointment)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openReview(appointment);
            }
          }}
        >
          <td className="schedule-time">
            {view !== "day" && <span className="schedule-date-mini">{compactDate(appointment.startsAt)}</span>}
            <strong>{appointmentTime(appointment.startsAt)}</strong>
            {appointment.id === currentAppointmentId && <span className="schedule-now-label">NOW</span>}
            {appointment.id === nextAppointmentId && <span className="schedule-next-label">NEXT</span>}
          </td>
          <td><strong>{appointment.clientName}</strong><span>{appointment.serviceType || "Appointment"} · {appointment.locationType.replaceAll("_", " ")}</span></td>
          <td><span className={`schedule-status ${statusTone}`}><StatusBadge value={appointment.checkInStatus} /></span></td>
          <td><div className="schedule-insight">{appointment.preVisitInsights.length > 0 ? appointment.preVisitInsights.map((insight) => <span className={`schedule-insight-pill ${insight.tone}`} key={insight.label}><strong>{insight.label}</strong>{insight.value}</span>) : <span className="schedule-insight-empty">No pre-visit signal yet</span>}</div></td>
          <td><div className={`schedule-focus ${focusAction.toLowerCase().replace(" ", "-")}`}><span>{focusAction}</span><strong>{appointment.sessionFocus ?? "No focus submitted"}</strong></div></td>
          <td className="schedule-chevron"><ChevronRight size={17} /></td>
        </tr>;
      })}</tbody></table></div>}
    </section>}

    <PatientReviewDrawer appointment={selectedAppointment} open={Boolean(selectedAppointment)} onOpenChange={(open) => { if (!open) closeReview(); }} onEditAppointment={selectedAppointment ? () => openEdit(selectedAppointment) : undefined} />

    {form && data && <WorkDrawer open={Boolean(form)} onOpenChange={(open) => { if (!open) closeEditDrawer(); }} dirty={dirty} title={editingId ? "Edit Appointment" : "New Appointment"} subtitle={editingId ? `${data.appointments.find((row) => row.id === editingId)?.clientName ?? "Patient"} · ${data.appointments.find((row) => row.id === editingId)?.providerName ?? "Provider"}` : "Schedule by patient and provider name"} footer={<div className="thera-filter-row" style={{ justifyContent: "space-between" }}><button type="button" className="thera-action secondary" onClick={() => { if (!dirty || window.confirm("Discard unsaved appointment changes?")) closeEditDrawer(); }}>Cancel</button><button type="button" className="thera-action" disabled={saving || !form.clientId || !form.providerId || !form.date || !form.time} onClick={() => void saveAppointment()}>{saving ? "Saving..." : editingId ? "Save Appointment" : "Schedule Appointment"}</button></div>}>
      <div className="schedule-appointment-form">
        {formError && <div className="thera-state error" role="alert">{formError}</div>}
        <section className="schedule-appointment-section" aria-labelledby="schedule-form-people">
          <div className="schedule-appointment-section-heading"><span>01</span><div><h3 id="schedule-form-people">Patient & provider</h3><p>Select the patient and clinician for this visit.</p></div></div>
          <div className="schedule-appointment-fields">
            <label>Patient <span className="schedule-required">Required</span>
              <select className="thera-input" required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                <option value="">Choose patient</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{personName(client)}</option>)}
              </select>
            </label>
            <label>Rendering provider <span className="schedule-required">Required</span>
              <select className="thera-input" required disabled={clinicianView} value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })}>
                <option value="">Choose provider</option>{data.providers.map((provider) => <option key={provider.id} value={provider.id}>{personName(provider)}{provider.credentials ? `, ${provider.credentials}` : ""}</option>)}
              </select>
              {clinicianView && <small>Linked to your signed-in clinician profile.</small>}
            </label>
          </div>
        </section>
        <section className="schedule-appointment-section" aria-labelledby="schedule-form-when">
          <div className="schedule-appointment-section-heading"><span>02</span><div><h3 id="schedule-form-when">Date & time</h3><p>Appointment duration appears on the encounter and supports session-time review.</p></div></div>
          <div className="schedule-appointment-fields when">
            <label>Date<input className="thera-input" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
            <label>Start time<input className="thera-input" type="time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
            <label>Duration<select className="thera-input" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}>
              <option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option>
            </select></label>
          </div>
        </section>
        <section className="schedule-appointment-section" aria-labelledby="schedule-form-visit">
          <div className="schedule-appointment-section-heading"><span>03</span><div><h3 id="schedule-form-visit">Visit details</h3><p>Choose the service and location. Procedure coding is managed during charge capture, not here.</p></div></div>
          <div className="schedule-appointment-fields">
            <label>Service type
              <select className="thera-input" value={form.serviceType} onChange={(e) => {
                const service = SERVICE_TYPES.find((item) => item.name === e.target.value);
                setForm({ ...form, serviceType: e.target.value, cptCode: service ? service.code : form.cptCode });
              }}>
                <option value="">Choose service</option>{SERVICE_TYPES.map((service) => <option value={service.name} key={service.name}>{service.name}</option>)}
                {form.serviceType && !SERVICE_TYPES.some((service) => service.name === form.serviceType) && <option value={form.serviceType}>{form.serviceType}</option>}
              </select>
              <small>Starting note template: <strong>{form.serviceType ? noteTemplateLabelForService(form.serviceType) : "Choose a service"}</strong></small>
            </label>
            <label>Visit location
              <select className="thera-input" value={form.locationType} onChange={(e) => setForm({ ...form, locationType: e.target.value as FormState["locationType"] })}>
                <option value="telehealth">Telehealth</option><option value="in_person">Office / in person</option><option value="phone">Phone</option>
                <option value="community">Community</option><option value="home">Home</option><option value="school">School</option><option value="other">Other</option>
              </select>
            </label>
          </div>
        </section>
        <div className="schedule-appointment-note"><strong>Clinical documentation stays independent.</strong><span>Scheduling creates the appointment only. Notes, charges and payer rules remain separate.</span></div>
      </div>
    </WorkDrawer>}
  </>;
}
