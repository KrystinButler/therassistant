import { Link } from "wouter";

import {
  phase1DemoScenarios,
  phase5MailroomScenarios,
} from "../domains/demo/scenarios";
import { money } from "../lib/format";
import { useApi } from "../lib/therassistant-api";

type DashboardData = {
  totalClients?: number;
  activeProviders?: number;
  openClaims?: number;
  deniedClaims?: number;
  openWorkItems?: number;
  totalOpenBalanceCents?: number;
};

const workflowLinks = [
  ["Schedule & Pre-Session", "/schedule"],
  ["Patient Portal — Taylor Brooks", "/patient-portal/cf537c94-9748-4725-aa11-ac7b503e83f7"],
  ["Clinical", "/clinical"],
  ["Eligibility", "/eligibility"],
  ["Authorizations", "/authorizations"],
  ["Charges", "/billing/charges"],
  ["Rejections", "/rejections"],
  ["Claims", "/claims"],
  ["Denials", "/denials"],
  ["Payments", "/payments"],
] as const;

export function DemoControlCenter() {
  const { data, loading, error } = useApi<DashboardData>("/api/dashboard");

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">GUIDED PRODUCT DEMO</div>
          <h1>Therassistant Phase 1 Demo</h1>
          <p>
            Follow connected synthetic records from scheduling and clinical documentation through billing,
            claim submission, payer response, payment posting, denials, and operational exception work.
          </p>
        </div>
        <Link href="/" className="thera-action secondary">Overview</Link>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="thera-metric-grid">
        <Metric name="Clients" value={loading ? "—" : data?.totalClients ?? 0} />
        <Metric name="Active Providers" value={loading ? "—" : data?.activeProviders ?? 0} />
        <Metric name="Open Claims" value={loading ? "—" : data?.openClaims ?? 0} />
        <Metric name="Denied Claims" value={loading ? "—" : data?.deniedClaims ?? 0} />
        <Metric name="Open Work" value={loading ? "—" : data?.openWorkItems ?? 0} />
        <Metric name="Open A/R" value={loading ? "—" : money(data?.totalOpenBalanceCents ?? 0)} />
      </div>

      <section className="thera-card thera-section-gap">
        <div className="thera-card-header">
          <div>
            <h2>Canonical Paths</h2>
            <p>Open each reference page or canonical workqueue directly. These are the Phase 1 paths covered by the workflow tests.</p>
          </div>
        </div>
        <div className="thera-filter-row">
          {workflowLinks.map(([label, href]) => (
            <Link key={href} href={href} className="thera-action secondary">{label}</Link>
          ))}
        </div>
      </section>

      <section className="thera-card thera-section-gap">
        <div className="thera-card-header">
          <div>
            <h2>Connected Demo Scenarios</h2>
            <p>Each card opens the actual synthetic patient or claim backing the scenario.</p>
          </div>
        </div>
        <div className="thera-story-grid">
          {phase1DemoScenarios.map((story) => (
            <Link
              key={story.title}
              href={story.href}
              className="thera-story"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div className="thera-eyebrow">{story.title}</div>
              <strong>{story.name}</strong>
              <p>{story.detail}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="thera-card thera-section-gap">
        <div className="thera-card-header">
          <div>
            <div className="thera-eyebrow">PHASE 5</div>
            <h2>Mailroom Scenarios</h2>
            <p>Open deterministic synthetic correspondence records that demonstrate review, deadlines, claim context, credentialing context, and completed follow-up.</p>
          </div>
          <Link href="/mailroom" className="thera-action secondary">Open Mailroom</Link>
        </div>
        <div className="thera-story-grid">
          {phase5MailroomScenarios.map((story) => (
            <Link
              key={story.title}
              href={story.href}
              className="thera-story"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div className="thera-eyebrow">{story.title}</div>
              <strong>{story.name}</strong>
              <p>{story.detail}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="thera-card thera-section-gap">
        <div className="thera-eyebrow">DEMO SAFETY</div>
        <h2>Synthetic Data Only</h2>
        <p>
          This preview uses synthetic records in the Therassistant Demo tenant. No real PHI is used. Payer
          responses and adjudication examples are illustrative workflow data, not current payer policy.
        </p>
      </section>
    </>
  );
}

function Metric({ name, value }: { name: string; value: string | number }) {
  return (
    <div className="thera-metric-card">
      <div className="thera-metric-label">{name}</div>
      <div className="thera-metric-value">{value}</div>
    </div>
  );
}
