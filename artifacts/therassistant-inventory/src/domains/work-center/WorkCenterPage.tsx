import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { WorkDrawer } from "../../components/work-drawer";
import { shortDate } from "../../lib/format";
import { tenantSelect, tenantUpdate, type Row } from "../../lib/tenant-data-client";

type WorkItem = Row & {
  id: string;
  workqueue_type: string;
  workqueue_status: string;
  priority: string;
  source_object_type: string;
  source_object_id: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
  assigned_user_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type StatusFilter = "active" | "open" | "in_progress" | "pending" | "snoozed" | "completed" | "all";

const ACTIVE = new Set(["open", "in_progress", "pending", "snoozed", "reopened"]);

function sourceRoute(item: WorkItem) {
  const type = String(item.source_object_type ?? "");
  const id = String(item.source_object_id ?? "");
  switch (type) {
    case "client": return `/clients/${id}`;
    case "appointment": return `/schedule?appointment=${encodeURIComponent(id)}`;
    case "encounter": return `/encounters/${id}`;
    case "claim": return `/claims/${id}`;
    case "denial": return "/denials";
    case "appeal": return "/denials";
    case "authorization": return "/authorizations";
    case "eligibility": return "/eligibility";
    case "payment": return "/payments";
    case "era": return "/payments";
    case "adjustment": return "/payments";
    case "charge": return "/billing/charges";
    case "claim_batch": return "/billing/charges";
    case "provider": return `/providers/${id}`;
    case "provider_enrollment":
    case "provider_payer_enrollment":
    case "provider_network_participation":
    case "credentialing_application":
    case "provider_credential":
    case "network_participation":
    case "roster_action":
    case "credentialing_issue":
      return "/credentialing";
    case "payer_contract": return "/payers-contracts";
    case "mailroom_item": return `/mailroom/${id}`;
    default: return null;
  }
}

function priorityWeight(value: string) {
  if (value === "urgent") return 4;
  if (value === "high") return 3;
  if (value === "normal") return 2;
  return 1;
}

function dueTone(date?: string | null) {
  if (!date) return "none";
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return "overdue";
  if (date === today) return "today";
  return "future";
}

export function WorkCenterPage() {
  const [, navigate] = useLocation();
  const [rows, setRows] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [typeFilter, setTypeFilter] = useState("");
  const [activeItem, setActiveItem] = useState<WorkItem | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const items = await tenantSelect<WorkItem>("workqueue_items", { order: "due_date.asc,created_at.asc" });
      setRows(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Work Center.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const types = useMemo(
    () => [...new Set(rows.map((row) => row.workqueue_type))].sort(),
    [rows],
  );

  const visible = useMemo(() => {
    return rows
      .filter((row) => {
        if (filter === "active") return ACTIVE.has(row.workqueue_status);
        if (filter === "all") return true;
        return row.workqueue_status === filter;
      })
      .filter((row) => !typeFilter || row.workqueue_type === typeFilter)
      .sort((a, b) => {
        const aOverdue = dueTone(a.due_date) === "overdue" ? 1 : 0;
        const bOverdue = dueTone(b.due_date) === "overdue" ? 1 : 0;
        if (aOverdue !== bOverdue) return bOverdue - aOverdue;
        const priority = priorityWeight(b.priority) - priorityWeight(a.priority);
        if (priority !== 0) return priority;
        return String(a.due_date ?? "9999-12-31").localeCompare(String(b.due_date ?? "9999-12-31"));
      });
  }, [rows, filter, typeFilter]);

  const metrics = useMemo(() => {
    const active = rows.filter((row) => ACTIVE.has(row.workqueue_status));
    const today = new Date().toISOString().slice(0, 10);
    return {
      active: active.length,
      overdue: active.filter((row) => row.due_date && row.due_date < today).length,
      urgent: active.filter((row) => row.priority === "urgent").length,
      inProgress: rows.filter((row) => row.workqueue_status === "in_progress").length,
    };
  }, [rows]);

  const activeIndex = activeItem ? visible.findIndex((row) => row.id === activeItem.id) : -1;

  function openAt(index: number) {
    const item = visible[index];
    if (item) setActiveItem(item);
  }

  async function updateStatus(status: string) {
    if (!activeItem) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const values: Row = {
        workqueue_status: status,
        ...(status === "completed"
          ? { completed_at: new Date().toISOString() }
          : { completed_at: null, completed_by: null }),
      };
      await tenantUpdate<WorkItem>("workqueue_items", activeItem.id, values);
      setMessage(status === "completed" ? "Work item completed." : `Work item moved to ${status.replaceAll("_", " ")}.`);
      setActiveItem(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update work item.");
    } finally {
      setSaving(false);
    }
  }

  async function updatePriority(priority: string) {
    if (!activeItem) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await tenantUpdate<WorkItem>("workqueue_items", activeItem.id, { priority });
      setActiveItem(updated);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update priority.");
    } finally {
      setSaving(false);
    }
  }

  async function updateDueDate(dueDate: string) {
    if (!activeItem) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await tenantUpdate<WorkItem>("workqueue_items", activeItem.id, { due_date: dueDate || null });
      setActiveItem(updated);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update due date.");
    } finally {
      setSaving(false);
    }
  }

  function openSource(item: WorkItem) {
    const route = sourceRoute(item);
    if (!route) {
      setError("This work item does not have a linked workspace yet.");
      return;
    }
    navigate(route);
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">OPERATIONS</div>
          <h1>Work Center</h1>
          <p>One queue for clinical, payer, billing, denial, payment, mailroom, and credentialing follow-up.</p>
        </div>
      </div>

      <div className="thera-metric-grid" style={{ marginBottom: 16 }}>
        <Metric label="Active Work" value={metrics.active} />
        <Metric label="Overdue" value={metrics.overdue} />
        <Metric label="Urgent" value={metrics.urgent} />
        <Metric label="In Progress" value={metrics.inProgress} />
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      <section className="thera-card" style={{ marginBottom: 16 }}>
        <div className="thera-filter-row" style={{ flexWrap: "wrap" }}>
          {(["active", "open", "in_progress", "pending", "snoozed", "completed", "all"] as StatusFilter[]).map((status) => (
            <button
              key={status}
              type="button"
              className={filter === status ? "thera-action" : "thera-action secondary"}
              onClick={() => setFilter(status)}
            >
              {status.replaceAll("_", " ")}
            </button>
          ))}
          <select className="thera-input" style={{ maxWidth: 260 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All work types</option>
            {types.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
          </select>
        </div>
      </section>

      {loading ? (
        <div className="thera-state">Loading Work Center...</div>
      ) : (
        <section className="thera-card">
          {visible.length === 0 ? (
            <div className="thera-empty">No work items match this view.</div>
          ) : (
            <div className="thera-table-wrap">
              <table className="thera-table">
                <thead>
                  <tr>
                    <th>Due</th>
                    <th>Priority</th>
                    <th>Work Type</th>
                    <th>Task</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.due_date ? shortDate(row.due_date) : "—"}
                        {dueTone(row.due_date) === "overdue" && <div className="thera-table-subtext">Overdue</div>}
                      </td>
                      <td><StatusBadge value={row.priority} /></td>
                      <td>{row.workqueue_type.replaceAll("_", " ")}</td>
                      <td>
                        <button type="button" className="thera-table-link" onClick={() => setActiveItem(row)}>{row.title}</button>
                        {row.description && <div className="thera-table-subtext">{row.description}</div>}
                      </td>
                      <td>{row.source_object_type.replaceAll("_", " ")}</td>
                      <td><StatusBadge value={row.workqueue_status} /></td>
                      <td>
                        <div className="thera-filter-row">
                          <button type="button" className="thera-action" onClick={() => setActiveItem(row)}>Work</button>
                          {sourceRoute(row) && <button type="button" className="thera-action secondary" onClick={() => openSource(row)}>Open Source</button>}
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

      {activeItem && (
        <WorkDrawer
          open={Boolean(activeItem)}
          onOpenChange={(open) => { if (!open) setActiveItem(null); }}
          title={activeItem.title}
          subtitle={activeItem.workqueue_type.replaceAll("_", " ")}
          badges={<><StatusBadge value={activeItem.priority} /><StatusBadge value={activeItem.workqueue_status} /></>}
          queuePosition={activeIndex >= 0 ? `${activeIndex + 1} of ${visible.length}` : undefined}
          onPrevious={() => openAt(activeIndex - 1)}
          onNext={() => openAt(activeIndex + 1)}
          previousDisabled={activeIndex <= 0}
          nextDisabled={activeIndex < 0 || activeIndex >= visible.length - 1}
          openFullRecord={sourceRoute(activeItem) ? () => openSource(activeItem) : undefined}
          openFullRecordLabel="Open Source Record"
          footer={
            <div className="thera-filter-row" style={{ justifyContent: "space-between", width: "100%" }}>
              <button type="button" className="thera-action secondary" onClick={() => setActiveItem(null)}>Close</button>
              <div className="thera-filter-row">
                {activeItem.workqueue_status !== "in_progress" && activeItem.workqueue_status !== "completed" && (
                  <button type="button" className="thera-action secondary" disabled={saving} onClick={() => void updateStatus("in_progress")}>Start Work</button>
                )}
                {activeItem.workqueue_status !== "pending" && activeItem.workqueue_status !== "completed" && (
                  <button type="button" className="thera-action secondary" disabled={saving} onClick={() => void updateStatus("pending")}>Pending</button>
                )}
                {activeItem.workqueue_status !== "completed" && (
                  <button type="button" className="thera-action" disabled={saving} onClick={() => void updateStatus("completed")}>Complete</button>
                )}
                {activeItem.workqueue_status === "completed" && (
                  <button type="button" className="thera-action secondary" disabled={saving} onClick={() => void updateStatus("reopened")}>Reopen</button>
                )}
              </div>
            </div>
          }
        >
          <div className="thera-stack">
            <section className="thera-card">
              <div className="thera-card-header"><div><h2>Task</h2><p>{activeItem.description || "No additional description."}</p></div></div>
              <div className="thera-definition-grid">
                <Field label="Work Type" value={activeItem.workqueue_type.replaceAll("_", " ")} />
                <Field label="Source" value={activeItem.source_object_type.replaceAll("_", " ")} />
                <Field label="Created" value={activeItem.created_at ? shortDate(activeItem.created_at) : "—"} />
                <Field label="Status" value={activeItem.workqueue_status.replaceAll("_", " ")} />
              </div>
            </section>

            <section className="thera-card">
              <div className="thera-card-header"><div><h2>Queue Controls</h2><p>Update priority and due date without leaving the queue.</p></div></div>
              <div className="thera-form-grid">
                <label className="thera-field">
                  <span className="thera-field-label">Priority</span>
                  <select className="thera-input" value={activeItem.priority} disabled={saving} onChange={(e) => void updatePriority(e.target.value)}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
                <label className="thera-field">
                  <span className="thera-field-label">Due Date</span>
                  <input className="thera-input" type="date" value={String(activeItem.due_date ?? "")} disabled={saving} onChange={(e) => void updateDueDate(e.target.value)} />
                </label>
              </div>
            </section>

            {sourceRoute(activeItem) && (
              <section className="thera-card">
                <h2>Source Record</h2>
                <p>Open the originating workspace to resolve the underlying issue. Completing this task does not change the source record itself.</p>
                <button type="button" className="thera-action secondary" onClick={() => openSource(activeItem)}>Open Source Record</button>
              </section>
            )}
          </div>
        </WorkDrawer>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="thera-metric-card"><div className="thera-metric-label">{label}</div><div className="thera-metric-value">{value}</div></div>;
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><div className="thera-field-label">{label}</div><div>{value}</div></div>;
}
