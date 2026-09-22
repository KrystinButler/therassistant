import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../components/status-badge";
import { getScheduleData, type ScheduleAppointment } from "../domains/scheduling/repository";
import { getWorkCenterData } from "../domains/work-center/repository";
import { money, shortDate } from "../lib/format";
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
  balances: DataRow[];
};

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
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "—";
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [schedule, workItems, clients, notes, charges, claims, balances] = await Promise.all([
        getScheduleData(),
        getWorkCenterData(),
        tenantSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
        tenantSelect<DataRow>("clinical_notes", { order: "service_date.desc" }),
        tenantSelect<DataRow>("charge_capture_items", { order: "service_date.desc" }),
        tenantSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
        tenantSelect<DataRow>("claim_balance_summaries"),
      ]);
      setData({
        appointments: schedule.appointments,
        workItems,
        clients,
        notes,
        charges,
        claims,
        balances,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load THERASSISTANT home.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const view = useMemo(() => {
    if (!data) return null;

    const today = new Date();
    const todayAppointments = data.appointments
      .filter((appointment) => sameLocalDay(appointment.startsAt, today))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    const preServiceAttention = todayAppointments.filter(
      (appointment) => appointment.checkInStatus !== "Ready",
    ).length;

    const unsignedNotes = data.notes.filter((note) =>
      unsignedNoteStatuses.has(String(note.note_status ?? "")),
    ).length;

    const readyCharges = data.charges.filter(
      (charge) => String(charge.charge_status ?? "") === "ready_for_claim",
    ).length;

    const blockedCharges = data.charges.filter(
      (charge) => String(charge.charge_status ?? "") === "blocked",
    ).length;

    const claimAttention = data.claims.filter((claim) =>
      claimAttentionStatuses.has(String(claim.claim_status ?? "")),
    ).length;

    const openWork = data.workItems.filter((item) =>
      activeWorkStatuses.has(String(item.workqueue_status ?? "")),
    );

    const priorityWork = [...openWork]
      .sort((a, b) => {
        const priorityDiff =
          (priorityRank[String(a.priority ?? "normal")] ?? 9) -
          (priorityRank[String(b.priority ?? "normal")] ?? 9);
        if (priorityDiff !== 0) return priorityDiff;
        return String(a.due_date ?? "9999-12-31").localeCompare(String(b.due_date ?? "9999-12-31"));
      })
      .slice(0, 6);

    const openAr = data.balances.reduce(
      (sum, row) => sum + Number(row.open_balance_cents ?? 0),
      0,
    );

    return {
      todayAppointments,
      preServiceAttention,
      unsignedNotes,
      readyCharges,
      blockedCharges,
      claimAttention,
      openWork,
      priorityWork,
      openAr,
    };
  }, [data]);

  if (loading) return <div className="thera-state">Loading connected workflow...</div>;
  if (error || !data || !view) {
    return <div className="thera-state error">{error || "Unable to load THERASSISTANT home."}</div>;
  }

  const stages = [
    {
      stage: "ENGAGE",
      title: "Patient engagement",
      detail: `${data.clients.length} patients · journal and portal activity`,
      href: "/clients",
      action: "Open patients",
    },
    {
      stage: "PREPARE",
      title: "Prepare for today's care",
      detail: `${view.todayAppointments.length} visits · ${view.preServiceAttention} need attention`,
      href: "/schedule",
      action: "Open schedule",
    },
    {
      stage: "DOCUMENT",
      title: "Complete the clinical record",
      detail: `${view.unsignedNotes} notes need signature or completion`,
      href: "/clinical",
      action: "Open clinical",
    },
    {
      stage: "GET PAID",
      title: "Move clean work to payment",
      detail: `${view.readyCharges} ready charges · ${view.claimAttention} claims need action`,
      href: "/billing/charges",
      action: "Open revenue cycle",
    },
    {
      stage: "OPERATE",
      title: "Run the practice",
      detail: `${view.openWork.length} active work items · ${money(view.openAr)} open A/R`,
      href: "/work-center",
      action: "Open Work Center",
    },
  ] as const;

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">CONNECTED BEHAVIORAL HEALTH WORKFLOW</div>
          <h1>Today in THERASSISTANT</h1>
          <p>
            One operating view from patient engagement and pre-session readiness through documentation,
            claims, payment, and practice follow-up.
          </p>
        </div>
        <div className="thera-filter-row">
          <Link href="/schedule" className="thera-action">Today&apos;s Schedule</Link>
          <Link href="/work-center" className="thera-action secondary">Work Center</Link>
        </div>
      </div>

      <section className="thera-flow-strip" aria-label="THERASSISTANT workflow">
        {stages.map((stage, index) => (
          <Link key={stage.stage} href={stage.href} className="thera-flow-stage">
            <div className="thera-flow-step">{String(index + 1).padStart(2, "0")}</div>
            <div className="thera-flow-copy">
              <div className="thera-eyebrow">{stage.stage}</div>
              <strong>{stage.title}</strong>
              <span>{stage.detail}</span>
              <em>{stage.action} →</em>
            </div>
          </Link>
        ))}
      </section>

      <div className="thera-metric-grid" style={{ marginBottom: 20 }}>
        <Metric label="Today&apos;s Visits" value={view.todayAppointments.length} />
        <Metric label="Pre-Service Attention" value={view.preServiceAttention} />
        <Metric label="Unsigned Notes" value={view.unsignedNotes} />
        <Metric label="Ready Charges" value={view.readyCharges} />
        <Metric label="Blocked Charges" value={view.blockedCharges} />
        <Metric label="Claim Attention" value={view.claimAttention} />
        <Metric label="Open Work" value={view.openWork.length} />
        <Metric label="Open A/R" value={money(view.openAr)} />
      </div>

      <div className="thera-dashboard-grid">
        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <div className="thera-eyebrow">PREPARE</div>
              <h2>Today&apos;s Schedule</h2>
              <p>Open the patient&apos;s pre-session review before the visit.</p>
            </div>
            <Link href="/schedule" className="thera-link">Full schedule</Link>
          </div>
          {view.todayAppointments.length === 0 ? (
            <div className="thera-empty">No appointments scheduled for today.</div>
          ) : (
            <div className="thera-stack">
              {view.todayAppointments.slice(0, 8).map((appointment) => (
                <Link
                  key={appointment.id}
                  href={`/schedule/${appointment.id}`}
                  className="thera-work-card thera-home-row"
                >
                  <div>
                    <strong>{appointmentTime(appointment.startsAt)} · {appointment.clientName}</strong>
                    <div className="thera-muted">
                      {appointment.providerName} · {appointment.serviceType || "Appointment"}
                    </div>
                  </div>
                  <div className="thera-home-row-status">
                    <StatusBadge value={appointment.checkInStatus} />
                    <span>{appointment.sessionFocus ?? "No session focus submitted"}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <div className="thera-eyebrow">OPERATE</div>
              <h2>Priority Work</h2>
              <p>Exceptions with an owner, status, source record, and next action.</p>
            </div>
            <Link href="/work-center" className="thera-link">All work</Link>
          </div>
          {view.priorityWork.length === 0 ? (
            <div className="thera-empty">No active exception work.</div>
          ) : (
            <div className="thera-stack">
              {view.priorityWork.map((item) => (
                <Link key={item.id} href={String(item.sourceRoute)} className="thera-work-card thera-home-row">
                  <div>
                    <div className="thera-work-card-top">
                      <StatusBadge value={String(item.priority ?? "normal")} />
                      <StatusBadge value={String(item.workqueue_status ?? "open")} />
                    </div>
                    <strong>{String(item.title ?? "Work item")}</strong>
                    <div className="thera-muted">
                      {[item.patientName, item.providerName, item.payerName]
                        .filter((value) => value && value !== "—")
                        .join(" · ") || String(item.relatedName ?? "Linked record")}
                    </div>
                  </div>
                  <div className="thera-home-row-status">
                    <span>{String(item.workqueue_type ?? "").replaceAll("_", " ")}</span>
                    <span>{item.due_date ? `Due ${shortDate(String(item.due_date))}` : "No due date"}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="thera-card">
        <div className="thera-card-header">
          <div>
            <div className="thera-eyebrow">GET PAID</div>
            <h2>Revenue Cycle Handoff</h2>
            <p>The manual&apos;s clean path is visible as one progression instead of disconnected billing screens.</p>
          </div>
        </div>
        <div className="thera-handoff-grid">
          <Handoff label="Signed Encounter" value="Clinical complete" href="/clinical" />
          <Handoff label="Charge Capture" value={`${view.readyCharges} ready · ${view.blockedCharges} blocked`} href="/billing/charges" />
          <Handoff label="Claims & 837P" value={`${data.claims.length} total claims`} href="/claims" />
          <Handoff label="Resolve" value={`${view.claimAttention} need action`} href="/rejections" />
          <Handoff label="Payment & A/R" value={money(view.openAr)} href="/payments" />
        </div>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="thera-metric-card">
      <div className="thera-metric-label">{label}</div>
      <div className="thera-metric-value">{value}</div>
    </div>
  );
}

function Handoff({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link className="thera-handoff-card" href={href}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>Open →</em>
    </Link>
  );
}
