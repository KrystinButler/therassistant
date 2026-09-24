import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight, Bell, CalendarDays, CheckCircle2, CircleDollarSign, ClipboardCheck,
  FileText, Inbox, RefreshCcw, UsersRound,
} from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { StatusBadge } from "../components/status-badge";
import { getScheduleData, type ScheduleAppointment } from "../domains/scheduling/repository";
import { getWorkCenterData } from "../domains/work-center/repository";
import { shortDate } from "../lib/format";
import { tenantSelect, type Row } from "../lib/tenant-data-client";

type DataRow = Row & { id: string };
type WorkItem = Awaited<ReturnType<typeof getWorkCenterData>>[number];
type DashboardState = {
  appointments: ScheduleAppointment[];
  workItems: WorkItem[];
  clients: DataRow[];
  notes: DataRow[];
  charges: DataRow[];
  claims: DataRow[];
};
type Alert = { id: string; title: string; detail: string; href: string; updatedAt?: string };
type ClientSummary = { id: string; name: string; status: string; last: string | null; next: string | null; activity: string };
const activeWorkStatuses = new Set(["open", "in_progress", "pending", "snoozed", "reopened"]);
const claimAttentionStatuses = new Set(["validation_failed", "rejected", "denied", "appealed"]);
const unsignedNoteStatuses = new Set(["draft", "ready_for_signature"]);
const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function sameLocalDay(value: string, date: Date) {
  const candidate = new Date(value);
  return Number.isFinite(candidate.getTime()) && candidate.toDateString() === date.toDateString();
}
function appointmentTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—";
}
function clientName(row: DataRow) {
  return String(row.display_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed patient");
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
}
function safeRoute(value: unknown) {
  const route = String(value || "/work-center");
  return route.startsWith("/") && !route.startsWith("//") && !route.startsWith("/mailroom")
    && !route.startsWith("/authorizations") ? route : "/work-center";
}

export function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(refresh = false) {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [schedule, workItems, clients, notes, charges, claims] = await Promise.all([
        getScheduleData(),
        getWorkCenterData(),
        tenantSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
        tenantSelect<DataRow>("clinical_notes", { order: "service_date.desc" }),
        tenantSelect<DataRow>("charge_capture_items", { order: "service_date.desc" }),
        tenantSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
      ]);
      setData({ appointments: schedule.appointments, workItems, clients, notes, charges, claims });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const nowMs = now.getTime();
    const todayAppointments = data.appointments
      .filter((appointment) => sameLocalDay(appointment.startsAt, now))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const unsignedNotes = data.notes.filter((note) => unsignedNoteStatuses.has(String(note.note_status ?? "")));
    const readyCharges = data.charges.filter((charge) => String(charge.charge_status ?? "") === "ready_for_claim");
    const blockedCharges = data.charges.filter((charge) => String(charge.charge_status ?? "") === "blocked");
    const attentionClaims = data.claims.filter((claim) => claimAttentionStatuses.has(String(claim.claim_status ?? "")));
    const priorityWork = data.workItems
      .filter((item) => activeWorkStatuses.has(String(item.workqueue_status ?? ""))
        && !["authorization", "mailroom_item"].includes(String(item.source_object_type ?? "")))
      .sort((a, b) => {
        const aRank = priorityRank[String(a.priority ?? "normal")] ?? 9;
        const bRank = priorityRank[String(b.priority ?? "normal")] ?? 9;
        return aRank - bRank || String(a.due_date ?? "9999-12-31").localeCompare(String(b.due_date ?? "9999-12-31"));
      });

    const visitsByClient = new Map<string, { last: string | null; next: string | null }>();
    for (const appointment of data.appointments) {
      if (!appointment.clientId) continue;
      const timestamp = new Date(appointment.startsAt).getTime();
      if (!Number.isFinite(timestamp)) continue;
      const current = visitsByClient.get(appointment.clientId) ?? { last: null, next: null };
      if (timestamp <= nowMs && (!current.last || appointment.startsAt > current.last)) current.last = appointment.startsAt;
      if (timestamp > nowMs && (!current.next || appointment.startsAt < current.next)) current.next = appointment.startsAt;
      visitsByClient.set(appointment.clientId, current);
    }
    const recentClients: ClientSummary[] = data.clients.map((client) => {
      const visits = visitsByClient.get(client.id);
      const activity = visits?.last || String(client.updated_at ?? client.created_at ?? "");
      return {
        id: client.id,
        name: clientName(client),
        status: String(client.client_status ?? "active"),
        last: visits?.last ?? null,
        next: visits?.next ?? null,
        activity,
      };
    }).sort((a, b) => b.activity.localeCompare(a.activity)).slice(0, 5);

    const alerts: Alert[] = attentionClaims
      .slice()
      .sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")))
      .slice(0, 3)
      .map((claim) => ({
        id: "claim-" + claim.id,
        title: "Claim " + String(claim.claim_status ?? "needs review").replaceAll("_", " "),
        detail: String(claim.patient_control_number || "Open claim for details"),
        href: "/claims/" + claim.id,
        updatedAt: String(claim.updated_at ?? claim.created_at ?? ""),
      }));
    if (unsignedNotes.length) alerts.push({
      id: "notes", title: "Clinical notes need completion",
      detail: unsignedNotes.length + " unsigned or draft notes", href: "/clinical",
    });
    if (blockedCharges.length) alerts.push({
      id: "charges", title: "Charges need review",
      detail: blockedCharges.length + " blocked charges", href: "/billing/charges",
    });
    return { todayAppointments, unsignedNotes, readyCharges, attentionClaims, priorityWork, recentClients, alerts: alerts.slice(0, 5) };
  }, [data]);

  if (loading) return <div className="thera-state">Loading today's practice overview...</div>;
  if (error || !data || !view) {
    return (
      <div className="thera-state error" role="alert">
        {error || "Unable to load dashboard."}
        <button type="button" className="thera-action secondary" onClick={() => void load()}>Try again</button>
      </div>
    );
  }

  const metadata = user?.user_metadata ?? {};
  const firstName = String(metadata.first_name || String(metadata.display_name || metadata.full_name || "").split(" ")[0] || "").trim();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="cw-dashboard">
      <div className="cw-dashboard-heading">
        <div>
          <h1>{greeting}{firstName ? ", " + firstName : ""}</h1>
          <p>Here's what's happening in your practice today.</p>
        </div>
        <div className="cw-dashboard-date">
          <span>{todayLabel}</span>
          <button className="cw-refresh" type="button" aria-label="Refresh dashboard" title="Refresh dashboard"
            onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCcw size={17} className={refreshing ? "cw-spinning" : undefined} />
          </button>
        </div>
      </div>

      <div className="cw-summary-grid" aria-label="Practice summary">
        <SummaryCard icon={<CalendarDays size={27} strokeWidth={1.75} />} label="Today's Appointments"
          value={view.todayAppointments.length} detail={view.todayAppointments.filter((appt) => appt.checkInStatus === "Ready").length + " checked in or ready"} href="/schedule" tone="sage" />
        <SummaryCard icon={<FileText size={27} strokeWidth={1.75} />} label="Notes to Complete"
          value={view.unsignedNotes.length} detail="Draft or awaiting signature" href="/clinical" tone="mint" />
        <SummaryCard icon={<ClipboardCheck size={27} strokeWidth={1.75} />} label="Charges Ready"
          value={view.readyCharges.length} detail="Ready for claim" href="/billing/charges" tone="cream" />
        <SummaryCard icon={<CircleDollarSign size={27} strokeWidth={1.75} />} label="Claims Needing Attention"
          value={view.attentionClaims.length} detail="Rejected, denied or to review" href="/claims" tone="blue" />
      </div>

      <div className="cw-dashboard-columns">
        <div className="cw-dashboard-column cw-dashboard-primary">
          <section className="cw-panel" aria-labelledby="cw-schedule-heading">
            <div className="cw-panel-header">
              <h2 id="cw-schedule-heading">Today's Schedule</h2>
              <Link href="/schedule" className="cw-panel-link">View Calendar <ArrowRight size={17} /></Link>
            </div>
            {view.todayAppointments.length ? (
              <div className="cw-table-scroll">
                <table className="cw-table">
                  <thead><tr><th>Time</th><th>Client</th><th>Appointment Type</th><th>Status</th><th><span className="cw-sr-only">Open</span></th></tr></thead>
                  <tbody>
                    {view.todayAppointments.slice(0, 7).map((appointment) => (
                      <tr key={appointment.id}>
                        <td className="cw-time-cell">{appointmentTime(appointment.startsAt)}</td>
                        <td>
                          <Link href={"/clients/" + appointment.clientId} className="cw-person-link">
                            <span className="cw-person-avatar">{initials(appointment.clientName)}</span>
                            <span>{appointment.clientName}</span>
                          </Link>
                        </td>
                        <td>{appointment.serviceType || "Appointment"}</td>
                        <td><StatusBadge value={appointment.checkInStatus === "Ready" ? "Ready" : appointment.appointmentStatus || "Scheduled"} /></td>
                        <td><Link href={"/schedule/" + appointment.id} aria-label={"Open appointment for " + appointment.clientName} className="cw-chevron-link"><ArrowRight size={17} /></Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={<CalendarDays size={22} />} message="No appointments scheduled for today." href="/schedule" action="View schedule" />
            )}
          </section>

          <section className="cw-panel" aria-labelledby="cw-clients-heading">
            <div className="cw-panel-header">
              <h2 id="cw-clients-heading">Recent Clients</h2>
              <Link href="/clients" className="cw-panel-link">View All <ArrowRight size={17} /></Link>
            </div>
            {view.recentClients.length ? (
              <div className="cw-table-scroll">
                <table className="cw-table">
                  <thead><tr><th>Client</th><th>Last Appointment</th><th>Next Appointment</th><th>Status</th><th><span className="cw-sr-only">Open</span></th></tr></thead>
                  <tbody>
                    {view.recentClients.map((client) => (
                      <tr key={client.id}>
                        <td><Link className="cw-person-link" href={"/clients/" + client.id}>
                          <span className="cw-person-avatar">{initials(client.name)}</span><span>{client.name}</span>
                        </Link></td>
                        <td>{client.last ? shortDate(client.last) : "—"}</td>
                        <td>{client.next ? shortDate(client.next) : "—"}</td>
                        <td><StatusBadge value={client.status} /></td>
                        <td><Link className="cw-chevron-link" href={"/clients/" + client.id} aria-label={"Open " + client.name}><ArrowRight size={17} /></Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon={<UsersRound size={22} />} message="No clients yet." href="/clients" action="Open clients" />}
          </section>
        </div>

        <div className="cw-dashboard-column cw-dashboard-secondary">
          <section className="cw-panel" aria-labelledby="cw-tasks-heading">
            <div className="cw-panel-header">
              <h2 id="cw-tasks-heading">My Tasks</h2>
              <Link href="/work-center" className="cw-panel-link">View All <ArrowRight size={17} /></Link>
            </div>
            {view.priorityWork.length ? (
              <div className="cw-list">
                {view.priorityWork.slice(0, 5).map((item) => (
                  <Link className="cw-task-row" key={item.id} href={safeRoute(item.sourceRoute)}>
                    <span className="cw-task-indicator"><span className="cw-task-square" /></span>
                    <span className="cw-task-copy">
                      <strong>{String(item.title || "Work item")}</strong>
                      <small>{[item.patientName, item.providerName, item.payerName]
                        .filter((value) => value && value !== "—").join(" · ") || String(item.relatedName || "Linked record")}</small>
                    </span>
                    <span className="cw-task-meta">
                      <span className={String(item.priority ?? "") === "urgent" || String(item.priority ?? "") === "high" ? "cw-task-urgent" : undefined}>
                        {item.due_date ? shortDate(String(item.due_date)) : String(item.priority || "").replaceAll("_", " ")}
                      </span>
                      <ArrowRight size={17} />
                    </span>
                  </Link>
                ))}
              </div>
            ) : <EmptyState icon={<CheckCircle2 size={22} />} message="No active tasks require attention." href="/work-center" action="Open Work Center" />}
          </section>

          <section className="cw-panel" aria-labelledby="cw-alerts-heading">
            <div className="cw-panel-header">
              <h2 id="cw-alerts-heading">Alerts &amp; Updates</h2>
              <Link href="/work-center" className="cw-panel-link">Work Center <ArrowRight size={17} /></Link>
            </div>
            {view.alerts.length ? (
              <div className="cw-list">
                {view.alerts.map((alert) => (
                  <Link className="cw-alert-row" href={alert.href} key={alert.id}>
                    <span className="cw-alert-icon"><Bell size={17} strokeWidth={1.6} /></span>
                    <span className="cw-alert-copy">
                      <strong>{alert.title}</strong>
                      <small>{alert.detail}</small>
                    </span>
                    {alert.updatedAt ? <span className="cw-alert-date">{shortDate(alert.updatedAt)}</span> : null}
                    <ArrowRight size={16} className="cw-alert-arrow" />
                  </Link>
                ))}
              </div>
            ) : <div className="cw-empty-alert"><Inbox size={23} /><p>No outstanding alerts.</p></div>}
          </section>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon, label, value, detail, href, tone,
}: {
  icon: React.ReactNode; label: string; value: number; detail: string; href: string;
  tone: "sage" | "mint" | "cream" | "blue";
}) {
  return (
    <Link href={href} className="cw-summary-card">
      <span className={"cw-summary-icon cw-summary-icon-" + tone}>{icon}</span>
      <span className="cw-summary-copy">
        <span className="cw-summary-label">{label}</span>
        <strong className="cw-summary-number">{value}</strong>
        <small>{detail}</small>
      </span>
      <ArrowRight className="cw-summary-arrow" size={18} strokeWidth={1.7} />
    </Link>
  );
}

function EmptyState({ icon, message, href, action }: { icon: React.ReactNode; message: string; href: string; action: string }) {
  return <div className="cw-empty-state"><span>{icon}</span><p>{message}</p>
    <Link href={href} className="cw-panel-link">{action} <ArrowRight size={16} /></Link></div>;
}
