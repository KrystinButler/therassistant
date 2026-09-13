import { Link } from "wouter";

import { StatusBadge } from "../components/status-badge";
import { phase1DemoScenarios } from "../domains/demo/scenarios";
import { money, shortDate } from "../lib/format";
import { useApi } from "../lib/therassistant-api";

type DashboardData = {
  totalClients?: number;
  activeProviders?: number;
  openClaims?: number;
  deniedClaims?: number;
  openWorkItems?: number;
  totalOpenBalanceCents?: number;
  recentWorkItems?: Array<Record<string, any>>;
  recentClaims?: Array<Record<string, any>>;
};

export function DashboardPage() {
  const { data, loading, error } = useApi<DashboardData>("/api/dashboard");

  if (loading) return <div className="thera-state">Loading Therassistant...</div>;
  if (error || !data) return <div className="thera-state error">Unable to load dashboard.{error ? ` ${error}` : ""}</div>;

  const metrics = [
    ["Clients", data.totalClients ?? 0],
    ["Active Providers", data.activeProviders ?? 0],
    ["Open Claims", data.openClaims ?? 0],
    ["Denied Claims", data.deniedClaims ?? 0],
    ["Open Work", data.openWorkItems ?? 0],
    ["Open A/R", money(data.totalOpenBalanceCents)],
  ];

  const quickLinks = [
    ["Schedule & Readiness", "/schedule"],
    ["Billing Queue", "/billing"],
    ["Claim Submission", "/claims/submission"],
    ["Payments / ERA", "/payments"],
    ["Work Center", "/work-center"],
  ] as const;

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">THERASSISTANT</div>
          <h1>Revenue Cycle Command Center</h1>
          <p>Operational control from pre-session readiness through encounter, billing, claims, payment, denial, and exception work.</p>
        </div>
        <div className="thera-filter-row">
          {quickLinks.map(([label, href]) => (
            <Link key={href} href={href} className="thera-action secondary">{label}</Link>
          ))}
        </div>
      </div>

      <div className="thera-metric-grid">
        {metrics.map(([name, metric]) => (
          <div className="thera-metric-card" key={String(name)}>
            <div className="thera-metric-label">{name}</div>
            <div className="thera-metric-value">{metric}</div>
          </div>
        ))}
      </div>

      <div className="thera-dashboard-grid">
        <section className="thera-card">
          <div className="thera-card-header">
            <div><h2>Priority Work</h2><p>Exceptions that need operational action.</p></div>
            <Link href="/work-center" className="thera-link">Open Work Center</Link>
          </div>
          {(data.recentWorkItems ?? []).length === 0 ? <div className="thera-empty">No open work.</div> : (
            <div className="thera-stack">
              {(data.recentWorkItems ?? []).map((item) => (
                <div className="thera-work-card" key={item.id}>
                  <div className="thera-work-card-top">
                    <StatusBadge value={item.priority} />
                    <StatusBadge value={item.workqueueStatus} />
                  </div>
                  <div className="thera-work-title">{item.title}</div>
                  <div className="thera-muted">{item.description}</div>
                  <div className="thera-work-footer">
                    <span>{item.workqueueType?.replaceAll("_", " ")}</span>
                    <span>Due {shortDate(item.dueDate)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="thera-card">
          <div className="thera-card-header">
            <div><h2>Recent Claims</h2><p>Claim status and remaining payer balance.</p></div>
            <Link href="/claims" className="thera-link">All Claims</Link>
          </div>
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead><tr><th>Client</th><th>Payer</th><th>Status</th><th>Balance</th></tr></thead>
              <tbody>
                {(data.recentClaims ?? []).map((claim) => (
                  <tr key={claim.id}>
                    <td><Link href={`/claims/${claim.id}`} className="thera-table-link">{claim.clientName}</Link></td>
                    <td>{claim.payerName}</td>
                    <td><StatusBadge value={claim.claimStatus} /></td>
                    <td>{money(claim.openBalanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="thera-card">
        <div className="thera-card-header">
          <div>
            <h2>Connected Phase 1 Demo Stories</h2>
            <p>Each story is backed by linked synthetic Supabase records and opens the record where the issue or outcome is visible.</p>
          </div>
        </div>
        <div className="thera-story-grid">
          {phase1DemoScenarios.map((story) => (
            <Link key={story.title} href={story.href} className="thera-story" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="thera-eyebrow">{story.title}</div>
              <strong>{story.name}</strong>
              <p>{story.detail}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
