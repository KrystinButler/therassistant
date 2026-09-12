import { Link } from "wouter";
import { StatusBadge } from "../components/status-badge";
import {
  money,
  shortDate,
} from "../lib/format";
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
  const {
    data,
    loading,
    error,
  } = useApi<DashboardData>("/api/dashboard");

  if (loading) {
    return <Loading />;
  }

  if (error || !data) {
    return <ErrorState message={error} />;
  }

  const metrics = [
    ["Clients", data.totalClients ?? 0],
    ["Active Providers", data.activeProviders ?? 0],
    ["Open Claims", data.openClaims ?? 0],
    ["Denied Claims", data.deniedClaims ?? 0],
    ["Priority Work", data.openWorkItems ?? 0],
    [
      "Open A/R",
      money(data.totalOpenBalanceCents),
    ],
  ];

  return (
    <>
      <PageHeader
        title="Revenue Cycle Command Center"
        subtitle="One operational view across clinical readiness, claims, denials, payments, credentialing, and payer work."
      />

      <div className="thera-metric-grid">
        {metrics.map(([name, metric]) => (
          <div
            className="thera-metric-card"
            key={String(name)}
          >
            <div className="thera-metric-label">
              {name}
            </div>

            <div className="thera-metric-value">
              {metric}
            </div>
          </div>
        ))}
      </div>

      <div className="thera-dashboard-grid">
        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <h2>Priority Work</h2>
              <p>
                Exceptions requiring operational action.
              </p>
            </div>

            <Link
              href="/work-center"
              className="thera-link"
            >
              Open Work Center
            </Link>
          </div>

          <div className="thera-stack">
            {(data.recentWorkItems ?? []).map(
              (item) => (
                <div
                  className="thera-work-card"
                  key={item.id}
                >
                  <div className="thera-work-card-top">
                    <StatusBadge
                      value={item.priority}
                    />

                    <StatusBadge
                      value={item.workqueueStatus}
                    />
                  </div>

                  <div className="thera-work-title">
                    {item.title}
                  </div>

                  <div className="thera-muted">
                    {item.description}
                  </div>

                  <div className="thera-work-footer">
                    <span>
                      {item.workqueueType
                        ?.replaceAll("_", " ")}
                    </span>

                    <span>
                      Due {shortDate(item.dueDate)}
                    </span>
                  </div>
                </div>
              ),
            )}
          </div>
        </section>

        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <h2>Recent Claims</h2>
              <p>
                Financial and payer status at a glance.
              </p>
            </div>

            <Link
              href="/claims"
              className="thera-link"
            >
              All Claims
            </Link>
          </div>

          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Payer</th>
                  <th>Status</th>
                  <th>Balance</th>
                </tr>
              </thead>

              <tbody>
                {(data.recentClaims ?? []).map(
                  (claim) => (
                    <tr key={claim.id}>
                      <td>
                        <Link
                          href={`/claims/${claim.id}`}
                          className="thera-table-link"
                        >
                          {claim.clientName}
                        </Link>
                      </td>

                      <td>{claim.payerName}</td>

                      <td>
                        <StatusBadge
                          value={claim.claimStatus}
                        />
                      </td>

                      <td>
                        {money(
                          claim.openBalanceCents,
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="thera-card">
        <div className="thera-card-header">
          <div>
            <h2>Therassistant Demo Stories</h2>
            <p>
              Connected scenarios demonstrate how
              operational data follows the work.
            </p>
          </div>
        </div>

        <div className="thera-story-grid">
          <Story
            name="Jordan Ellis"
            title="Clean Revenue Cycle"
            detail="Appointment → signed note → charge → claim → payment → zero balance."
          />

          <Story
            name="Morgan Reed"
            title="Denial & Appeal"
            detail="Claim denial → CARC/RARC → Work Center → first-level appeal."
          />

          <Story
            name="Taylor Brooks"
            title="Medicaid Readiness"
            detail="Upcoming service → Medicaid coverage → authorization and documentation alerts."
          />

          <Story
            name="Casey Martin"
            title="Underpayment"
            detail="Payment posts below expected allowed amount → variance routed for review."
          />

          <Story
            name="Jamie Parker, LCSW"
            title="Credentialing Impact"
            detail="Provider enrollment issue blocks claim submission before revenue is lost."
          />
        </div>
      </section>
    </>
  );
}

function Story({
  name,
  title,
  detail,
}: {
  name: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="thera-story">
      <div className="thera-eyebrow">
        {title}
      </div>
      <strong>{name}</strong>
      <p>{detail}</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="thera-state">
      Loading Therassistant...
    </div>
  );
}

function ErrorState({
  message,
}: {
  message?: string | null;
}) {
  return (
    <div className="thera-state error">
      Unable to load dashboard.
      {message ? ` ${message}` : ""}
    </div>
  );
}

function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="thera-page-header">
      <div>
        <div className="thera-eyebrow">
          THERASSISTANT
        </div>

        <h1>{title}</h1>

        <p>{subtitle}</p>
      </div>
    </div>
  );
}
