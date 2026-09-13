import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { money } from "../../lib/format";
import { demoSelect, type Row } from "../../lib/supabase-demo-client";
import { calculateOpenBalance } from "../ar/aging";
import { getArWorkspaceData } from "../ar/repository";
import { isRecoveryAdjustment } from "../ar/variance";
import { buildBillingHubSummary } from "./hub";

type DataRow = Row & { id: string };
type OpenClaimRow = DataRow & { openBalanceCents: number };
type VarianceRow = Awaited<ReturnType<typeof getArWorkspaceData>>["variances"][number];

type HubData = {
  charges: DataRow[];
  claims: DataRow[];
  payments: DataRow[];
  denials: DataRow[];
  appeals: DataRow[];
  allocations: DataRow[];
  adjustments: DataRow[];
  variances: VarianceRow[];
};

function activeAmount(rows: DataRow[], field: string) {
  return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
}

function claimBalance(claim: DataRow, allocations: DataRow[], adjustments: DataRow[]) {
  const claimId = String(claim.id);
  const paid = activeAmount(
    allocations.filter((row) => row.claim_id === claimId && !row.reversed_at),
    "amount_cents",
  );
  const activeAdjustments = adjustments.filter(
    (row) => row.claim_id === claimId && row.adjustment_status !== "reversed" && row.adjustment_status !== "voided",
  );
  const adjusted = activeAmount(
    activeAdjustments.filter((row) => !isRecoveryAdjustment(row.adjustment_type)),
    "amount_cents",
  );
  const recovery = activeAmount(
    activeAdjustments.filter((row) => isRecoveryAdjustment(row.adjustment_type)),
    "amount_cents",
  );
  return calculateOpenBalance(Number(claim.total_charge_cents ?? 0), paid, adjusted, recovery);
}

export function BillingHubPage() {
  const [data, setData] = useState<HubData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      demoSelect<DataRow>("charge_capture_items", { order: "created_at.desc" }),
      demoSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
      demoSelect<DataRow>("payments", { order: "created_at.desc" }),
      demoSelect<DataRow>("denials", { order: "created_at.desc" }),
      demoSelect<DataRow>("appeals", { order: "created_at.desc" }),
      demoSelect<DataRow>("payment_allocations", { order: "created_at.desc" }),
      demoSelect<DataRow>("adjustments", { order: "created_at.desc" }),
      getArWorkspaceData(),
    ])
      .then(([charges, claims, payments, denials, appeals, allocations, adjustments, arData]) => {
        if (active) setData({ charges, claims, payments, denials, appeals, allocations, adjustments, variances: arData.variances });
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load Billing.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const summary = useMemo(() => {
    if (!data) return null;
    const openClaims = data.claims
      .map((claim): OpenClaimRow => ({ ...claim, openBalanceCents: claimBalance(claim, data.allocations, data.adjustments) }))
      .filter((claim) => claim.openBalanceCents > 0);
    const patientAr = openClaims.filter((claim) => claim.claim_status === "patient_responsibility");
    const insuranceAr = openClaims.filter((claim) => claim.claim_status !== "patient_responsibility");
    const recoveryItems = data.adjustments.filter((row) =>
      isRecoveryAdjustment(row.adjustment_type)
      && !["reversed", "voided"].includes(String(row.adjustment_status ?? "")),
    );

    return buildBillingHubSummary({
      charges: data.charges,
      claims: data.claims,
      payments: data.payments,
      denials: data.denials,
      appeals: data.appeals,
      insuranceAr,
      patientAr,
      variances: data.variances,
      recoveryItems,
    });
  }, [data]);

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">REVENUE CYCLE</div>
          <h1>Billing</h1>
          <p>Route billing work to the right operational queue without mixing readiness, claims, payments, and A/R into one list.</p>
        </div>
        <Link className="thera-action" href="/billing/charges">Open Charge Readiness</Link>
      </div>

      {loading && <div className="thera-state">Loading billing work...</div>}
      {error && <div className="thera-state error">{error}</div>}
      {!loading && !error && summary && (
        <div className="thera-stack">
          <section className="thera-card">
            <div className="thera-card-header"><div><h2>Billing Routing</h2><p>Choose the workflow that matches the exception or financial state.</p></div></div>
            <div className="thera-metric-grid">
              <Metric title="Charges Ready" metric={summary.readyCharges} href="/billing/charges" />
              <Metric title="Claims Needing Action" metric={summary.claimsNeedAction} href="/claims" />
              <Metric title="Unapplied Payments" metric={summary.unappliedPayments} href="/payments" />
              <Metric title="Insurance A/R" metric={summary.insuranceAr} href="/ar-denials?tab=insurance" />
              <Metric title="Patient A/R" metric={summary.patientAr} href="/ar-denials?tab=patient" />
              <Metric title="Active Denials" metric={summary.denials} href="/ar-denials?tab=denials" />
              <Metric title="Active Appeals" metric={summary.appeals} href="/ar-denials?tab=appeals" />
              <Metric title="Underpayments" metric={summary.underpayments} href="/ar-denials?tab=variance" />
              <Metric title="Refunds / Recoupments" metric={summary.recovery} href="/ar-denials?tab=recovery" />
            </div>
          </section>

          <section className="thera-card">
            <div className="thera-card-header"><div><h2>Primary Workspaces</h2><p>Billing readiness stays separate from claim adjudication and revenue recovery.</p></div></div>
            <div className="thera-filter-row">
              <Link className="thera-action" href="/billing/charges">Charge Capture</Link>
              <Link className="thera-action secondary" href="/claims">Claims</Link>
              <Link className="thera-action secondary" href="/claims/submission">837P Submission</Link>
              <Link className="thera-action secondary" href="/payments">Payments / ERA</Link>
              <Link className="thera-action secondary" href="/ar-denials">A/R & Denials</Link>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function Metric({ title, metric, href }: { title: string; metric: { count: number; amountCents: number }; href: string }) {
  return (
    <Link className="thera-metric-card" href={href}>
      <div className="thera-metric-label">{title}</div>
      <div className="thera-metric-value">{metric.count}</div>
      <div className="thera-table-subtext">{money(metric.amountCents)}</div>
    </Link>
  );
}
