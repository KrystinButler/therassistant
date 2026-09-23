import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { money } from "../lib/format";
import { tenantSelect } from "../lib/tenant-data-client";

type Row = Record<string, any>;
type LoadState<T> = { data: T | null; loading: boolean; error: string | null };

function useLoad<T>(loader: () => Promise<T>): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    loader()
      .then((value) => { if (active) setData(value); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Unable to load data"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return { data, loading, error };
}

function WorkspaceHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="thera-page-header split"><div><div className="thera-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function State({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <div className="thera-state">Loading...</div>;
  if (error) return <div className="thera-state error">{error}</div>;
  return null;
}

export function ReportsPage() {
  const state = useLoad(async () => {
    const [clients, providers, claims, balances, payments, denials, work] = await Promise.all([
      tenantSelect("clients"),
      tenantSelect("providers"),
      tenantSelect("professional_claims"),
      tenantSelect("claim_balance_summaries"),
      tenantSelect("payments"),
      tenantSelect("denials"),
      tenantSelect("workqueue_items"),
    ]);
    return { clients, providers, claims, balances, payments, denials, work };
  });

  const data = state.data;
  const balanceByClaim = new Map((data?.balances ?? []).map((row) => [String(row.claim_id), row]));
  const financialClaims = (data?.claims ?? []).filter(
    (claim) =>
      Number(claim.total_charge_cents ?? 0) > 0
      && !["voided", "reversed"].includes(String(claim.claim_status ?? "")),
  );
  const missingBalanceClaims = financialClaims.filter(
    (claim) => !balanceByClaim.has(String(claim.id)),
  );
  const reconciledClaims = financialClaims.filter(
    (claim) => balanceByClaim.has(String(claim.id)),
  );
  const openClaims = reconciledClaims.filter((claim) => {
    const balance = balanceByClaim.get(String(claim.id));
    return Number(balance?.open_balance_cents ?? 0) > 0;
  });
  const openAr = openClaims.reduce((sum, claim) => {
    const balance = balanceByClaim.get(String(claim.id));
    return sum + Number(balance?.open_balance_cents ?? 0);
  }, 0);
  const now = Date.now();
  const arOver90 = openClaims.reduce((sum, claim) => {
    const dos = String(claim.service_date_from ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dos)) return sum;
    const serviceDate = new Date(`${dos}T00:00:00Z`);
    if (!Number.isFinite(serviceDate.getTime())) return sum;
    const ageDays = Math.floor((now - serviceDate.getTime()) / 86_400_000);
    if (ageDays <= 90) return sum;
    const balance = balanceByClaim.get(String(claim.id));
    return sum + Number(balance?.open_balance_cents ?? 0);
  }, 0);
  const arOver90Percent = openAr > 0 ? (arOver90 / openAr) * 100 : 0;
  const claimAttention = (data?.claims ?? []).filter((claim) =>
    ["rejected", "denied", "validation_failed"].includes(String(claim.claim_status ?? "")),
  ).length;
  const openWork = (data?.work ?? []).filter((item) =>
    !["completed", "cancelled"].includes(String(item.workqueue_status ?? "")),
  ).length;
  const postedPaymentRows = (data?.payments ?? []).filter((payment) =>
    ["posted", "partially_applied"].includes(String(payment.payment_status ?? ""))
    && Boolean(payment.posted_at),
  );
  const postedPayments = postedPaymentRows.reduce(
    (sum, payment) => sum + Number(payment.amount_cents ?? 0),
    0,
  );
  const reversedPayments = (data?.payments ?? []).filter(
    (payment) => ["reversed", "voided"].includes(String(payment.payment_status ?? "")),
  ).length;

  return (
    <>
      <WorkspaceHeader
        eyebrow="OPERATE · MANAGEMENT VIEW"
        title="Reports"
        description="Operational and financial indicators reconcile to the same claims, payments, denials, and workqueues staff are actively using."
        action={
          <div className="thera-filter-row">
            <Link className="thera-action secondary" href="/claims">Claims</Link>
            <Link className="thera-action secondary" href="/payments">Payments</Link>
            <Link className="thera-action secondary" href="/denials">Denials</Link>
            <Link className="thera-action" href="/work-center">Work Center</Link>
          </div>
        }
      />
      <State loading={state.loading} error={state.error} />

      {data && (
        <>
          {missingBalanceClaims.length > 0 && (
            <div className="thera-state error" style={{ marginBottom: 16 }}>
              {missingBalanceClaims.length} financial claim(s) are missing a reconciled balance summary and are excluded from A/R totals until recalculated.
            </div>
          )}

          <div className="thera-metric-grid">
            <div className="thera-metric-card">
              <div className="thera-metric-label">Active Patients</div>
              <div className="thera-metric-value">{data.clients.filter((row) => row.client_status === "active").length}</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Active Providers</div>
              <div className="thera-metric-value">{data.providers.filter((row) => row.provider_status === "active").length}</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Open A/R</div>
              <div className="thera-metric-value">{money(openAr)}</div>
              <div className="thera-table-subtext">Reconciled claim balances only</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">A/R Over 90</div>
              <div className="thera-metric-value">{money(arOver90)}</div>
              <div className="thera-table-subtext">{arOver90Percent.toFixed(1)}% of reconciled open A/R · 91+ days from DOS</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Missing Balances</div>
              <div className="thera-metric-value">{missingBalanceClaims.length}</div>
              <div className="thera-table-subtext">Excluded from A/R denominator</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Claim Exceptions</div>
              <div className="thera-metric-value">{claimAttention}</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Active Denials</div>
              <div className="thera-metric-value">{data.denials.filter((row) => !["resolved", "resolved_writeoff", "closed"].includes(String(row.denial_status ?? ""))).length}</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Posted Payments</div>
              <div className="thera-metric-value">{money(postedPayments)}</div>
              <div className="thera-table-subtext">Posted or partially applied only · reversed/voided excluded</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Reversed / Voided Payments</div>
              <div className="thera-metric-value">{reversedPayments}</div>
              <div className="thera-table-subtext">Excluded from posted-payment total</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Open Work</div>
              <div className="thera-metric-value">{openWork}</div>
            </div>
          </div>

          <section className="thera-card">
            <div className="thera-card-header">
              <div>
                <h2>Management Follow-Up</h2>
                <p>A/R aging uses service date. The over-90 denominator is current reconciled open A/R; payment totals use posting status, not receipt/download activity.</p>
              </div>
            </div>
            <div className="thera-story-grid">
              <div className="thera-story">
                <strong>Claims requiring attention</strong>
                <p>{claimAttention} rejected, denied, or validation-failed claims need action.</p>
                <Link className="thera-link" href="/rejections">Open claim exceptions</Link>
              </div>
              <div className="thera-story">
                <strong>Revenue recovery</strong>
                <p>{money(arOver90)} of {money(openAr)} reconciled open A/R is 91+ days from service.</p>
                <Link className="thera-link" href="/claims">Open A/R follow-up</Link>
              </div>
              <div className="thera-story">
                <strong>Balance integrity</strong>
                <p>{missingBalanceClaims.length === 0 ? "All financial claims included in this report have balance summaries." : `${missingBalanceClaims.length} financial claim(s) require balance recalculation before management totals are complete.`}</p>
                <Link className="thera-link" href="/claims">Review claims</Link>
              </div>
              <div className="thera-story">
                <strong>Audit readiness</strong>
                <p>Review tenant activity history across clinical, financial, payer, and document actions.</p>
                <Link className="thera-link" href="/administration/audit">Open Audit History</Link>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
