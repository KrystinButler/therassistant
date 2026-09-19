import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../components/status-badge";
import { dateTime, shortDate } from "../lib/format";
import {
  changeWorkPriority,
  completeWorkItem,
  getWorkCenterData,
  pendWorkItem,
  reopenWorkItem,
  startWorkItem,
} from "../domains/work-center/repository";

type WorkItemBase = Awaited<ReturnType<typeof getWorkCenterData>>[number];
type WorkItem = WorkItemBase & {
  workqueue_type: string;
  priority: string;
  workqueue_status: string;
  due_date: string | null;
  title: string;
  description: string | null;
  source_object_type: string;
};
type DueFilter = "all" | "overdue" | "next7" | "none";

export function WorkCenterPage() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState("all");
  const [priority, setPriority] = useState("all");
  const [status, setStatus] = useState("all");
  const [payer, setPayer] = useState("all");
  const [due, setDue] = useState<DueFilter>("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems(await getWorkCenterData() as WorkItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Work Center.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const queues = useMemo(
    () => [...new Set(items.map((item) => String(item.workqueue_type)))].sort(),
    [items],
  );
  const payers = useMemo(
    () => [...new Set(items.map((item) => String(item.payerName)).filter((name) => name && name !== "—"))].sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const now = new Date();
    const end7 = new Date(now);
    end7.setDate(end7.getDate() + 7);
    const term = search.trim().toLowerCase();

    return items.filter((item) => {
      if (queue !== "all" && item.workqueue_type !== queue) return false;
      if (priority !== "all" && item.priority !== priority) return false;
      if (status !== "all" && item.workqueue_status !== status) return false;
      if (payer !== "all" && item.payerName !== payer) return false;

      const dueDate = item.due_date ? new Date(`${String(item.due_date)}T23:59:59`) : null;
      if (due === "overdue" && (!dueDate || dueDate >= now)) return false;
      if (due === "next7" && (!dueDate || dueDate < now || dueDate > end7)) return false;
      if (due === "none" && dueDate) return false;

      if (term) {
        const haystack = [
          item.title,
          item.description,
          item.relatedName,
          item.patientName,
          item.providerName,
          item.payerName,
          item.workqueue_type,
        ].join(" ").toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [items, queue, priority, status, payer, due, search]);

  const activeItems = items.filter((item) => !["completed", "cancelled"].includes(String(item.workqueue_status)));
  const overdueCount = activeItems.filter((item) => {
    if (!item.due_date) return false;
    return new Date(`${String(item.due_date)}T23:59:59`) < new Date();
  }).length;
  const urgentCount = activeItems.filter((item) => item.priority === "urgent").length;
  const inProgressCount = items.filter((item) => item.workqueue_status === "in_progress").length;

  async function execute(id: string, action: () => Promise<any>, successMessage: string) {
    setSavingId(id);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage(successMessage);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update work item.");
    } finally {
      setSavingId(null);
    }
  }

  function promptNote(label: string) {
    const note = window.prompt(label);
    return note?.trim() || null;
  }

  return (
    <>
      <div className="thera-page-header">
        <div>
          <div className="thera-eyebrow">UNIFIED OPERATIONS</div>
          <h1>Work Center</h1>
          <p>Exception work across clinical, payer, billing, payment, mailroom, and credentialing workflows.</p>
        </div>
      </div>

      <div className="thera-metric-grid" style={{ marginBottom: 16 }}>
        <Metric label="Active Work" value={activeItems.length} />
        <Metric label="Overdue" value={overdueCount} />
        <Metric label="Urgent" value={urgentCount} />
        <Metric label="In Progress" value={inProgressCount} />
      </div>

      <section className="thera-card" style={{ marginBottom: 16 }}>
        <div className="thera-filter-row">
          <input className="thera-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Patient, provider, payer, or work item" />
          <select className="thera-select" value={queue} onChange={(event) => setQueue(event.target.value)}>
            <option value="all">All queues</option>
            {queues.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select>
          <select className="thera-select" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="all">All priorities</option>
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
          <select className="thera-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="open">Open</option><option value="in_progress">In Progress</option><option value="pending">Pending</option><option value="snoozed">Snoozed</option><option value="reopened">Reopened</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </select>
          <select className="thera-select" value={payer} onChange={(event) => setPayer(event.target.value)}>
            <option value="all">All payers</option>
            {payers.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="thera-select" value={due} onChange={(event) => setDue(event.target.value as DueFilter)}>
            <option value="all">All due dates</option><option value="overdue">Overdue</option><option value="next7">Next 7 days</option><option value="none">No due date</option>
          </select>
        </div>
      </section>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      <section className="thera-card">
        {loading && <div className="thera-state">Loading Work Center...</div>}
        {!loading && filtered.length === 0 && <div className="thera-empty">No work matches these filters.</div>}

        {!loading && filtered.length > 0 && (
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr><th>Priority</th><th>Queue / Work</th><th>Related Record</th><th>Patient / Provider</th><th>Payer</th><th>Status</th><th>Due</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const itemStatus = String(item.workqueue_status);
                  const active = !["completed", "cancelled"].includes(itemStatus);
                  return (
                    <tr key={item.id}>
                      <td>
                        <select
                          className="thera-select"
                          value={String(item.priority)}
                          disabled={savingId === item.id}
                          onChange={(event) => void execute(
                            item.id,
                            () => changeWorkPriority(item.id, event.target.value as "low" | "normal" | "high" | "urgent"),
                            "Priority updated.",
                          )}
                        >
                          <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
                        </select>
                      </td>
                      <td>
                        <div>{String(item.workqueue_type).replaceAll("_", " ")}</div>
                        <strong>{String(item.title)}</strong>
                        <div className="thera-table-subtext">{String(item.description || "")}</div>
                      </td>
                      <td>
                        <Link className="thera-table-link" href={String(item.sourceRoute)}>{String(item.relatedName || "Open source")}</Link>
                        <div className="thera-table-subtext">{String(item.source_object_type || "").replaceAll("_", " ")}</div>
                      </td>
                      <td>{item.patientName !== "—" ? item.patientName : item.providerName}</td>
                      <td>{item.payerName}</td>
                      <td><StatusBadge value={itemStatus} /></td>
                      <td>{item.due_date ? shortDate(String(item.due_date)) : "—"}</td>
                      <td>
                        <div className="thera-filter-row">
                          {["open", "reopened", "pending", "snoozed"].includes(itemStatus) && (
                            <button type="button" className="thera-action secondary" disabled={savingId === item.id} onClick={() => void execute(item.id, () => startWorkItem(item.id), "Work started.")}>Start</button>
                          )}
                          {active && (
                            <button type="button" className="thera-action secondary" disabled={savingId === item.id} onClick={() => {
                              const note = promptNote("Why is this work pending?");
                              if (note) void execute(item.id, () => pendWorkItem(item.id, note), "Work pended.");
                            }}>Pend</button>
                          )}
                          {active && (
                            <button type="button" className="thera-action secondary" disabled={savingId === item.id} onClick={() => {
                              const note = promptNote("Why is this work being snoozed?");
                              if (note) void execute(item.id, () => pendWorkItem(item.id, note, true), "Work snoozed.");
                            }}>Snooze</button>
                          )}
                          {active && (
                            <button type="button" className="thera-action" disabled={savingId === item.id} onClick={() => {
                              const note = promptNote("Completion note");
                              if (note) void execute(item.id, () => completeWorkItem(item.id, note), "Work completed.");
                            }}>Complete</button>
                          )}
                          {!active && (
                            <button type="button" className="thera-action" disabled={savingId === item.id} onClick={() => {
                              const note = promptNote("Why is this work being reopened?");
                              if (note) void execute(item.id, () => reopenWorkItem(item.id, note), "Work reopened.");
                            }}>Reopen</button>
                          )}
                          <Link className="thera-action secondary" href={String(item.sourceRoute)}>Open Source</Link>
                        </div>
                        <details style={{ marginTop: 8 }}>
                          <summary className="thera-link">History ({item.history.length})</summary>
                          <div className="thera-stack" style={{ marginTop: 8 }}>
                            {item.history.length
                              ? item.history.map((history) => (
                                  <div className="thera-work-card" key={history.id}>
                                    <div className="thera-work-card-top">
                                      <span>{dateTime(String(history.created_at ?? ""))}</span>
                                      <span>{history.old_status ? String(history.old_status).replaceAll("_", " ") : "—"} → {history.new_status ? String(history.new_status).replaceAll("_", " ") : "—"}</span>
                                    </div>
                                    {history.old_priority !== history.new_priority && <div className="thera-muted">Priority: {String(history.old_priority || "—")} → {String(history.new_priority || "—")}</div>}
                                    <div>{String(history.note || "")}</div>
                                  </div>
                                ))
                              : <div className="thera-muted">No history recorded yet.</div>}
                          </div>
                        </details>
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
  return <div className="thera-metric-card"><div className="thera-metric-label">{label}</div><div className="thera-metric-value">{value}</div></div>;
}
