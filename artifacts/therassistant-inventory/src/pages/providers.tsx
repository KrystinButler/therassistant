import { Link } from "wouter";
import { StatusBadge } from "../components/status-badge";
import { useApi } from "../lib/therassistant-api";

type Provider = {
  id: string;
  firstName: string;
  lastName: string;
  credentials?: string | null;
  providerStatus: string;
  individualNpi?: string | null;
  taxonomyCode?: string | null;
  email?: string | null;
  claimCount?: number;
  openIssueCount?: number;
};

export function ProvidersPage() {
  const { data, loading, error } =
    useApi<Provider[]>("/api/providers");

  return (
    <>
      <div className="thera-page-header">
        <div>
          <div className="thera-eyebrow">
            PROVIDER OPERATIONS
          </div>

          <h1>Providers</h1>

          <p>
            Clinical activity, billing activity, and
            payer-related operational issues.
          </p>
        </div>
      </div>

      <section className="thera-card">
        {loading && (
          <div className="thera-state">
            Loading providers...
          </div>
        )}

        {error && (
          <div className="thera-state error">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>NPI</th>
                  <th>Taxonomy</th>
                  <th>Status</th>
                  <th>Claims</th>
                  <th>Open Issues</th>
                </tr>
              </thead>

              <tbody>
                {(data ?? []).map((provider) => (
                  <tr key={provider.id}>
                    <td>
                      <Link
                        href={`/providers/${provider.id}`}
                        className="thera-table-link"
                      >
                        {provider.firstName}{" "}
                        {provider.lastName}
                        {provider.credentials
                          ? `, ${provider.credentials}`
                          : ""}
                      </Link>

                      <div className="thera-table-subtext">
                        {provider.email || ""}
                      </div>
                    </td>

                    <td>
                      {provider.individualNpi ||
                        "—"}
                    </td>

                    <td>
                      {provider.taxonomyCode ||
                        "—"}
                    </td>

                    <td>
                      <StatusBadge
                        value={
                          provider.providerStatus
                        }
                      />
                    </td>

                    <td>
                      {provider.claimCount ?? 0}
                    </td>

                    <td>
                      {(provider.openIssueCount ??
                        0) > 0 ? (
                        <StatusBadge value="needs review" />
                      ) : (
                        "0"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
