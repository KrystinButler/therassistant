import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, shortDate } from "../../lib/format";
import { tenantSelect, type Row } from "../../lib/tenant-data-client";
import { flagJournalEntry, markJournalReviewed } from "./repository";
import { PORTAL_LOGIN } from "../portal/routes";

type DataRow = Row & { id: string };

type JournalEntry = DataRow & {
  client_id?: string | null;
  entry_date?: string | null;
  entry_text?: string | null;
  mood?: string | null;
  author_type?: string | null;
  review_status?: string | null;
  visibility?: string | null;
  tags?: unknown;
  related_treatment_goal_id?: string | null;
  entry_status?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  recorded_by_staff_user_id?: string | null;
};

type ReviewFilter = "needs_review" | "flagged" | "reviewed" | "all";

function patientName(row?: DataRow | null) {
  if (!row) return "Unknown patient";
  return [row.preferred_name || row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown patient";
}

function tagList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean);
}

export function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [clients, setClients] = useState<DataRow[]>([]);
  const [goals, setGoals] = useState<DataRow[]>([]);
  const [filter, setFilter] = useState<ReviewFilter>("needs_review");
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [entryRows, clientRows, goalRows] = await Promise.all([
        tenantSelect<JournalEntry>("patient_journal_entries", { order: "created_at.desc" }),
        tenantSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
        tenantSelect<DataRow>("treatment_plan_goals"),
      ]);
      setEntries(entryRows);
      setClients(clientRows);
      setGoals(goalRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load journal review queue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const clientsById = useMemo(() => new Map(clients.map((row) => [row.id, row])), [clients]);
  const goalsById = useMemo(() => new Map(goals.map((row) => [row.id, row])), [goals]);

  const sharedEntries = useMemo(
    () => entries.filter((entry) =>
      String(entry.author_type ?? "patient") === "patient" &&
      String(entry.visibility ?? "shared_with_provider") === "shared_with_provider" &&
      String(entry.entry_status ?? "submitted") === "submitted"
    ),
    [entries],
  );

  const counts = useMemo(() => ({
    needsReview: sharedEntries.filter((entry) => !["reviewed", "flagged"].includes(String(entry.review_status ?? "unreviewed"))).length,
    flagged: sharedEntries.filter((entry) => entry.review_status === "flagged").length,
    reviewed: sharedEntries.filter((entry) => entry.review_status === "reviewed").length,
  }), [sharedEntries]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sharedEntries.filter((entry) => {
      const status = String(entry.review_status ?? "unreviewed");
      if (filter === "needs_review" && ["reviewed", "flagged"].includes(status)) return false;
      if (filter === "flagged" && status !== "flagged") return false;
      if (filter === "reviewed" && status !== "reviewed") return false;

      if (!term) return true;
      const client = clientsById.get(String(entry.client_id ?? ""));
      const goal = entry.related_treatment_goal_id ? goalsById.get(String(entry.related_treatment_goal_id)) : null;
      return [
        patientName(client),
        entry.entry_text,
        entry.mood,
        goal?.goal_text,
        ...tagList(entry.tags),
      ].join(" ").toLowerCase().includes(term);
    });
  }, [sharedEntries, filter, search, clientsById, goalsById]);

  async function runReview(entryId: string) {
    setSavingId(entryId);
    setError(null);
    setMessage(null);
    try {
      await markJournalReviewed(entryId);
      setMessage("Journal entry marked reviewed. The patient-authored entry remains separate from the clinical note.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to mark journal entry reviewed.");
    } finally {
      setSavingId(null);
    }
  }

  async function runFlag(entryId: string) {
    setSavingId(entryId);
    setError(null);
    setMessage(null);
    try {
      await flagJournalEntry(entryId);
      setMessage("Journal entry flagged for clinical attention.");
      await load();
      setFilter("flagged");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to flag journal entry.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">PATIENT-REPORTED CONTEXT</div>
          <h1>Journal Review</h1>
          <p>Review patient-shared journal entries without converting patient-authored content into signed clinical documentation.</p>
        </div>
        <div className="journal-portal-tools" style={{ display: "grid", gap: 8, width: "min(360px, 100%)" }}>
          <a href={PORTAL_LOGIN} target="_blank" rel="noopener noreferrer"
            className="thera-action" style={{ justifySelf: "end" }}
            title="Open patient portal sign-in in a separate browser session">
            Open Patient Portal ↗
          </a>
          <p className="thera-table-subtext" style={{ margin: 0, textAlign: "right", lineHeight: 1.5 }}>
            For testing alongside your staff account, open the portal in a private browser window and sign in as an invited synthetic patient.
            Staff access does not grant patient-portal access.
          </p>
          <input className="thera-input" style={{ width: "100%" }}
            placeholder="Search patient, mood, goal, or text..."
            aria-label="Search journal reviews" value={search}
            onChange={(event) => setSearch(event.target.value)} />
        </div>
      </div>

      <div className="thera-metric-grid" style={{ marginBottom: 16 }}>
        <Metric label="Needs Review" value={counts.needsReview} />
        <Metric label="Flagged" value={counts.flagged} />
        <Metric label="Reviewed" value={counts.reviewed} />
      </div>

      <div className="thera-tabs" style={{ marginBottom: 16 }}>
        <Tab active={filter === "needs_review"} label={`Needs Review (${counts.needsReview})`} onClick={() => setFilter("needs_review")} />
        <Tab active={filter === "flagged"} label={`Flagged (${counts.flagged})`} onClick={() => setFilter("flagged")} />
        <Tab active={filter === "reviewed"} label={`Reviewed (${counts.reviewed})`} onClick={() => setFilter("reviewed")} />
        <Tab active={filter === "all"} label={`All (${sharedEntries.length})`} onClick={() => setFilter("all")} />
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}
      {loading && <div className="thera-state">Loading journal review queue...</div>}

      {!loading && visible.length === 0 && (
        <section className="thera-card"><div className="thera-empty">No patient-shared journal entries match this view.</div></section>
      )}

      {!loading && visible.length > 0 && (
        <div className="thera-stack">
          {visible.map((entry) => {
            const client = clientsById.get(String(entry.client_id ?? ""));
            const goal = entry.related_treatment_goal_id ? goalsById.get(String(entry.related_treatment_goal_id)) : null;
            const tags = tagList(entry.tags);
            return (
              <article className="thera-card" key={entry.id}>
                <div className="thera-card-header split">
                  <div>
                    <h2><Link className="thera-table-link" href={`/clients/${String(entry.client_id ?? "")}`}>{patientName(client)}</Link></h2>
                    <p>
                      {entry.entry_date ? shortDate(String(entry.entry_date)) : entry.submitted_at ? dateTime(String(entry.submitted_at)) : "—"}
                      {entry.mood ? ` · ${String(entry.mood)}` : ""}
                      {" · "}{entry.recorded_by_staff_user_id ? "Patient-reported (staff transcribed)" : "Patient-authored"}
                    </p>
                  </div>
                  <StatusBadge value={String(entry.review_status ?? "unreviewed")} />
                </div>

                <p style={{ whiteSpace: "pre-wrap" }}>{String(entry.entry_text ?? "")}</p>

                {(goal || tags.length > 0) && (
                  <div className="thera-definition-grid" style={{ marginTop: 14 }}>
                    {goal && <Field label="Related Treatment Goal" value={String(goal.goal_text ?? "Linked treatment goal")} />}
                    {tags.length > 0 && <Field label="Tags" value={tags.join(", ")} />}
                  </div>
                )}

                <div className="thera-filter-row" style={{ marginTop: 14 }}>
                  <Link className="thera-action secondary" href={`/clients/${String(entry.client_id ?? "")}`}>Open Patient Chart</Link>
                  {entry.review_status !== "reviewed" && (
                    <button type="button" className="thera-action" disabled={savingId === entry.id} onClick={() => void runReview(entry.id)}>
                      {savingId === entry.id ? "Saving..." : "Mark Reviewed"}
                    </button>
                  )}
                  {entry.review_status !== "flagged" && (
                    <button type="button" className="thera-action secondary" disabled={savingId === entry.id} onClick={() => void runFlag(entry.id)}>
                      Flag for Attention
                    </button>
                  )}
                  {entry.reviewed_at && <span className="thera-table-subtext">Reviewed {dateTime(String(entry.reviewed_at))}</span>}
                </div>
              </article>
            );
          })}
        </div>
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

function Field({ label, value }: { label: string; value: string }) {
  return <div><div className="thera-field-label">{label}</div><div>{value}</div></div>;
}
