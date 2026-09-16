import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "../../components/status-badge";
import { money, shortDate } from "../../lib/format";
import { getDenialTab } from "../rcm/queue-routing";
import {
  createDenialAppeal,
  recordAppealOutcome,
  startDenialWork,
  submitAppeal,
  writeOffDenial,
} from "./denial-repository";
import {
  deferDenial,
  getDenialsQueueData,
  resumeDenial,
  type DenialAppealRow,
  type DenialQueueRow,
} from "./denials-queue-repository";
import { AppealOutcomeDrawer, CreateAppealDrawer, WorkDenialDrawer } from "./ar-work-drawers";

type Data = Awaited<ReturnType<typeof getDenialsQueueData>>;
type TabKey = "corrected_claims" | "appeals" | "deferred" | string;

const CLOSED_DENIAL_STATUSES = ["resolved", "resolved_writeoff", "closed"];
const ACTIVE_APPEAL_STATUSES = ["not_started", "drafting", "submitted", "pending"];

function isActive(row: DenialQueueRow) {
  return !CLOSED_DENIAL_STATUSES.includes(String(row.denial_status ?? ""));
}

function denialTab(row: DenialQueueRow): TabKey {
  return getDenialTab({
    deferred: ["pending", "snoozed"].includes(row.workStatus),
    appealActive: Boolean(row.activeAppealId),
    correctedClaim:
      row.claimStatus === "corrected"
      || ["corrected", "corrected_claim"].includes(String(row.denial_status ?? "")),
    denialCategory: row.carc_code ? `carc_${String(row.carc_code)}` : row.denial_category,
  });
}

function tabLabel(tab: TabKey) {
  if (tab === "corrected_claims") return "Corrected Claims";
  if (tab === "appeals") return "Appeals";
  if (tab === "deferred") return "Deferred";
  if (tab.startsWith("carc_")) return `CARC ${tab.slice(5).replaceAll("_", "-")}`;
  return tab.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function DenialsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [payerId, setPayerId] = useState("");
  const [tab, setTab] = useState<TabKey>("corrected_claims");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [denialWork, setDenialWork] = useState<DenialQueueRow | null>(null);
  const [appealDenial, setAppealDenial] = useState<DenialQueueRow | null>(null);
  const [appealOutcome, setAppealOutcome] = useState<DenialAppealRow | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const next = await getDenialsQueueData();
      setData(next);
      const active = next.denials.filter(isActive);
      setPayerId((current) => current || String(active[0]?.payer_id ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load denials.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const activeRows = useMemo(() => (data?.denials ?? []).filter(isActive), [data]);
  const payerOptions = useMemo(() => {
    const seen = new Set<string>();
    return activeRows.flatMap((row) => {
      const id = String(row.payer_id ?? "");
      if (!id || seen.has(id)) return [];
      seen.add(id);
      return [{ id, name: row.payerName }];
    });
  }, [activeRows]);
  const payerRows = useMemo(
    () => activeRows.filter((row) => !payerId || String(row.payer_id ?? "") === payerId),
    [activeRows, payerId],
  );
  const tabs = useMemo(() => {
    const carcTabs = Array.from(
      new Set(
        payerRows
          .map(denialTab)
          .filter((value) => !["corrected_claims", "appeals", "deferred"].includes(value)),
      ),
    ).sort();
    return ["corrected_claims", "appeals", "deferred", ...carcTabs] as TabKey[];
  }, [payerRows]);
  const tabRows = useMemo(() => payerRows.filter((row) => denialTab(row) === tab), [payerRows, tab]);
  const appealRows = useMemo(
    () => (data?.appeals ?? []).filter((row) => {
      if (!ACTIVE_APPEAL_STATUSES.includes(String(row.appeal_status ?? ""))) return false;
      const denial = payerRows.find((item) => item.id === String(row.denial_id ?? ""));
      return Boolean(denial);
    }),
    [data, payerRows],
  );

  useEffect(() => {
    if (tabs.includes(tab)) return;
    setTab(tabs.find((value) => payerRows.some((row) => denialTab(row) === value)) ?? "corrected_claims");
  }, [payerId, payerRows, tab, tabs]);

  async function act(label: string, action: () => Promise<unknown>, after?: () => void) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(label);
      after?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete denial action.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="thera-page-header">
        <div className="thera-eyebrow">PAYER DENIAL WORK</div>
        <h1>Denials</h1>
        <p>Work active denials by payer and CARC, with corrected claims, appeals, and deferred follow-up kept in the same payer queue.</p>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}
      {loading && <div className="thera-state">Loading denials...</div>}

      {!loading && data && (
        <div className="thera-stack">
          <section className="thera-card">
            <div className="thera-card-header split">
              <div>
                <h2>Payer Queue</h2>
                <p>Select a payer, then work the applicable CARC or special queue.</p>
              </div>
              <select className="thera-input" value={payerId} onChange={(event) => setPayerId(event.target.value)}>
                {payerOptions.length === 0 && <option value="">No active payer denials</option>}
                {payerOptions.map((payer) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}
              </select>
            </div>
            <div className="thera-metric-grid">
              <div className="thera-metric-card"><div className="thera-metric-label">Active Denials</div><div className="thera-metric-value">{payerRows.length}</div></div>
              <div className="thera-metric-card"><div className="thera-metric-label">Denied Amount</div><div className="thera-metric-value">{money(payerRows.reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0))}</div></div>
              <div className="thera-metric-card"><div className="thera-metric-label">Active Appeals</div><div className="thera-metric-value">{appealRows.length}</div></div>
            </div>
          </section>

          <div className="thera-tabs" style={{ marginBottom: 4 }}>
            {tabs.map((value) => {
              const count = value === "appeals" ? appealRows.length : payerRows.filter((row) => denialTab(row) === value).length;
              return <button key={value} type="button" className={tab === value ? "thera-tab active" : "thera-tab"} onClick={() => setTab(value)}>{tabLabel(value)} ({count})</button>;
            })}
          </div>

          {tab === "appeals"
            ? <AppealsTable rows={appealRows} saving={saving} onSubmit={(row) => void act("Appeal submitted.", () => submitAppeal(row.id))} onOutcome={setAppealOutcome} />
            : <DenialsTable rows={tabRows} saving={saving} onOpen={setDenialWork} onDefer={(row) => void act("Denial deferred.", () => deferDenial(row.id))} onResume={(row) => void act("Denial returned to active follow-up.", () => resumeDenial(row.id))} />}
        </div>
      )}

      <WorkDenialDrawer
        open={Boolean(denialWork)}
        onOpenChange={(open) => { if (!open) setDenialWork(null); }}
        row={denialWork}
        saving={saving}
        onStartWork={(row) => void act("Denial work started.", () => startDenialWork(row.id))}
        onCreateAppeal={(row) => { setAppealDenial(row as DenialQueueRow); setDenialWork(null); }}
        onWriteOff={(row) => void act("Denial written off under configured policy.", () => writeOffDenial(row.id), () => setDenialWork(null))}
      />
      <CreateAppealDrawer
        open={Boolean(appealDenial)}
        onOpenChange={(open) => { if (!open) setAppealDenial(null); }}
        row={appealDenial}
        saving={saving}
        onSave={(row, level, deadline, notes) => act("Appeal draft created.", () => createDenialAppeal(row.id, level, deadline, notes), () => setAppealDenial(null))}
      />
      <AppealOutcomeDrawer
        open={Boolean(appealOutcome)}
        onOpenChange={(open) => { if (!open) setAppealOutcome(null); }}
        row={appealOutcome}
        saving={saving}
        onSave={(row, outcome) => act("Appeal outcome recorded.", () => recordAppealOutcome(row.id, outcome), () => setAppealOutcome(null))}
      />
    </>
  );
}

function DenialsTable({
  rows,
  saving,
  onOpen,
  onDefer,
  onResume,
}: {
  rows: DenialQueueRow[];
  saving: boolean;
  onOpen: (row: DenialQueueRow) => void;
  onDefer: (row: DenialQueueRow) => void;
  onResume: (row: DenialQueueRow) => void;
}) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No denials are in this payer queue.</div></section>;
  return <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim / Patient</th><th>CARC / RARC</th><th>Reason</th><th>Amount</th><th>Status</th><th>Deadline</th><th>Action</th></tr></thead><tbody>{rows.map((row) => {
    const deferred = ["pending", "snoozed"].includes(row.workStatus);
    return <tr key={row.id}><td><button type="button" className="thera-table-link" onClick={() => onOpen(row)}>{row.claimNumber}</button><div className="thera-table-subtext">{row.clientName}</div></td><td>{String(row.carc_code ?? "—")} / {String(row.rarc_code ?? "—")}</td><td>{String(row.reason ?? row.denial_category ?? "—")}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td><StatusBadge value={String(row.denial_status ?? "new")} /><div className="thera-table-subtext">{row.workStatus || row.policy}</div></td><td>{row.timely_filing_deadline ? shortDate(String(row.timely_filing_deadline)) : "—"}</td><td><div className="thera-filter-row"><button type="button" className="thera-action secondary" onClick={() => onOpen(row)}>Open</button>{deferred ? <button type="button" className="thera-action secondary" disabled={saving} onClick={() => onResume(row)}>Resume</button> : <button type="button" className="thera-action secondary" disabled={saving} onClick={() => onDefer(row)}>Defer</button>}</div></td></tr>;
  })}</tbody></table></div></section>;
}

function AppealsTable({ rows, saving, onSubmit, onOutcome }: { rows: DenialAppealRow[]; saving: boolean; onSubmit: (row: DenialAppealRow) => void; onOutcome: (row: DenialAppealRow) => void }) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No active appeals for this payer.</div></section>;
  return <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim / Patient</th><th>Denial</th><th>Level</th><th>Status</th><th>Due</th><th>Submitted</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.claimNumber}<div className="thera-table-subtext">{row.clientName}</div></td><td>{row.denialCategory.replaceAll("_", " ")}</td><td>{String(row.appeal_level ?? "—")}</td><td><StatusBadge value={String(row.appeal_status ?? "not_started")} /></td><td>{row.deadline_date ? shortDate(String(row.deadline_date)) : "—"}</td><td>{row.submitted_at ? shortDate(String(row.submitted_at)) : "—"}</td><td>{["not_started", "drafting"].includes(String(row.appeal_status)) ? <button type="button" className="thera-action" disabled={saving} onClick={() => onSubmit(row)}>Submit</button> : <button type="button" className="thera-action secondary" disabled={saving} onClick={() => onOutcome(row)}>Record Outcome</button>}</td></tr>)}</tbody></table></div></section>;
}
