import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import {
  createChargeFromEncounter,
  getBillingQueueData,
  routeEncounterToBilling,
} from "./repository";

type BillingData = Awaited<ReturnType<typeof getBillingQueueData>>;
type QueueTab = "ready" | "blocked" | "charges" | "claimed";

export function BillingQueuePage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [tab, setTab] = useState<QueueTab>("ready");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getBillingQueueData());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load billing queue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const groups = useMemo(() => {
    if (!data) return { ready: [], blocked: [], claimed: [] };
    return {
      ready: data.encounters.filter((row) => ["ready", "not_ready"].includes(String(row.billing_status)) && !data.chargesByEncounter.get(row.id)?.length),
      blocked: data.encounters.filter((row) => row.billing_status === "held" || row.blockingChecks.length > 0),
      claimed: data.encounters.filter((row) => row.billing_status === "claimed" || data.chargesByEncounter.get(row.id)?.some((charge) => charge.charge_status === "claim_created")),
    };
  }, [data]);

  async function runAction(id: string, action: "audit" | "charge") {
    setSavingId(id);
    setError(null);
    setMessage(null);
    try {
      const result = action === "audit"
        ? await routeEncounterToBilling(id)
        : await createChargeFromEncounter(id);
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage(action === "audit" ? "Billing-readiness audit completed." : "Charge created and scrubbed for claim creation.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete billing action.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <div className="thera-page-header">
        <div>
          <div className="thera-eyebrow">BILLING READINESS</div>
          <h1>Billing</h1>
          <p>Signed encounters are audited, corrected, and converted to charges before claim creation.</p>
        </div>
      </div>

      <div className="thera-tabs" style={{ marginBottom: 16 }}>
        <Tab active={tab === "ready"} onClick={() => setTab("ready")} label={`Ready to Bill (${groups.ready.length})`} />
        <Tab active={tab === "blocked"} onClick={() => setTab("blocked")} label={`Blocked / Needs Correction (${groups.blocked.length})`} />
        <Tab active={tab === "charges"} onClick={() => setTab("charges")} label={`Charges Ready for Claim (${data?.charges.filter((row) => row.charge_status === "ready_for_claim").length ?? 0})`} />
        <Tab active={tab === "claimed"} onClick={() => setTab("claimed")} label={`Claim Created (${groups.claimed.length})`} />
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}
      {loading && <div className="thera-state">Loading billing readiness...</div>}

      {!loading && data && tab === "charges" && <ChargesTable data={data} />}
      {!loading && data && tab !== "charges" && (
        <EncounterTable
          rows={tab === "ready" ? groups.ready : tab === "blocked" ? groups.blocked : groups.claimed}
          data={data}
          savingId={savingId}
          onAudit={(id) => void runAction(id, "audit")}
          onCharge={(id) => void runAction(id, "charge")}
        />
      )}
    </>
  );
}

function Tab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" className={active ? "thera-tab active" : "thera-tab"} onClick={onClick}>{label}</button>;
}

function EncounterTable({
  rows,
  data,
  savingId,
  onAudit,
  onCharge,
}: {
  rows: BillingData["encounters"];
  data: BillingData;
  savingId: string | null;
  onAudit: (id: string) => void;
  onCharge: (id: string) => void;
}) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No encounters in this billing queue.</div></section>;

  return (
    <section className="thera-card">
      <div className="thera-table-wrap">
        <table className="thera-table">
          <thead><tr><th>DOS</th><th>Patient</th><th>Provider</th><th>Payer</th><th>Encounter</th><th>Billing</th><th>Blocking Issues</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const charges = data.chargesByEncounter.get(row.id) ?? [];
              return <tr key={row.id}>
                <td>{shortDate(String(row.started_at ?? ""))}</td>
                <td>{row.clientName}</td>
                <td>{row.providerName}</td>
                <td>{row.payerName}</td>
                <td><StatusBadge value={String(row.encounter_status)} /></td>
                <td><StatusBadge value={String(row.billing_status)} /></td>
                <td>{row.blockingChecks.length ? <><StatusBadge value="blocked" /><div className="thera-table-subtext">{row.blockingChecks.map((check) => String(check.message)).join(" · ")}</div></> : "—"}</td>
                <td><div className="thera-filter-row"><Link className="thera-action secondary" href={`/encounters/${row.id}`}>Open Encounter</Link><button type="button" className="thera-action secondary" disabled={savingId === row.id} onClick={() => onAudit(row.id)}>Run Audit</button>{row.billing_status === "ready" && charges.length === 0 && <button type="button" className="thera-action" disabled={savingId === row.id} onClick={() => onCharge(row.id)}>Create Charge</button>}</div></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ChargesTable({ data }: { data: BillingData }) {
  const encounters = new Map(data.encounters.map((row) => [row.id, row]));
  const rows = data.charges.filter((row) => row.charge_status === "ready_for_claim");
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No charges are ready for claim creation.</div></section>;

  return <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Service Date</th><th>Patient</th><th>Provider</th><th>Payer</th><th>CPT / Dx</th><th>Charge</th><th>Status</th><th>Source</th></tr></thead><tbody>{rows.map((charge) => { const encounter = encounters.get(String(charge.encounter_id)); return <tr key={charge.id}><td>{shortDate(String(charge.service_date ?? ""))}</td><td>{encounter?.clientName ?? "—"}</td><td>{encounter?.providerName ?? "—"}</td><td>{encounter?.payerName ?? "—"}</td><td>{String(charge.cpt_code ?? "—")}<div className="thera-table-subtext">Dx {String(charge.diagnosis_code ?? "—")}</div></td><td>{money(Number(charge.charge_amount_cents ?? 0))}</td><td><StatusBadge value={String(charge.charge_status)} /></td><td>{encounter ? <Link className="thera-link" href={`/encounters/${encounter.id}`}>Open Encounter</Link> : "—"}</td></tr>; })}</tbody></table></div></section>;
}
