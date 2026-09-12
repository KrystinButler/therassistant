import { Link, useRoute } from "wouter";
import { StatusBadge } from "../components/status-badge";
import {
  money,
  shortDate,
} from "../lib/format";
import { useApi } from "../lib/therassistant-api";

type Detail = {
  provider: Record<string, any>;
  appointments: Array<Record<string, any>>;
  clinicalNotes: Array<Record<string, any>>;
  charges: Array<Record<string, any>>;
  renderingClaims: Array<Record<string, any>>;
  billingClaims: Array<Record<string, any>>;
  workItems: Array<Record<string, any>>;
};

export function ProviderDetailPage() {
  const [, params] = useRoute<{
    id: string;
  }>("/providers/:id");

  const { data, loading, error } =
    useApi<Detail>(
      `/api/providers/${params?.id ?? ""}`,
    );

  if (loading) {
    return (
      <div className="thera-state">
        Loading provider...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="thera-state error">
        {error || "Provider not found"}
      </div>
    );
  }

  const provider = data.provider;

  return (
    <>
      <div className="thera-breadcrumb">
        <Link
          href="/providers"
          className="thera-link"
        >
          Providers
        </Link>
        <span>/</span>
        <span>
          {provider.first_name}{" "}
          {provider.last_name}
        </span>
      </div>

      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">
            PROVIDER 360
          </div>

          <h1>
            {provider.first_name}{" "}
            {provider.last_name}
            {provider.credentials
              ? `, ${provider.credentials}`
              : ""}
          </h1>

          <p>
            NPI{" "}
            {provider.individual_npi || "—"} ·
            Taxonomy{" "}
            {provider.taxonomy_code || "—"}
          </p>
        </div>

        <StatusBadge
          value={provider.provider_status}
        />
      </div>

      {data.workItems.length > 0 && (
        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <h2>Operational Issues</h2>
              <p>
                Provider issues affecting revenue
                cycle readiness.
              </p>
            </div>
          </div>

          <div className="thera-stack">
            {data.workItems.map((item) => (
              <div
                className="thera-alert danger"
                key={item.id}
              >
                <div className="thera-row-between">
                  <strong>{item.title}</strong>

                  <StatusBadge
                    value={item.priority}
                  />
                </div>

                <div>{item.description}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="thera-detail-grid">
        <section className="thera-card">
          <h2>Provider Information</h2>

          <div className="thera-definition-grid">
            <Field
              name="Email"
              value={provider.email || "—"}
            />

            <Field
              name="Phone"
              value={provider.phone || "—"}
            />

            <Field
              name="NPI"
              value={
                provider.individual_npi || "—"
              }
            />

            <Field
              name="Taxonomy"
              value={
                provider.taxonomy_code || "—"
              }
            />
          </div>
        </section>

        <section className="thera-card">
          <h2>Activity</h2>

          <div className="thera-definition-grid">
            <Field
              name="Appointments"
              value={data.appointments.length}
            />
            <Field
              name="Clinical Notes"
              value={data.clinicalNotes.length}
            />
            <Field
              name="Charges"
              value={data.charges.length}
            />
            <Field
              name="Rendering Claims"
              value={data.renderingClaims.length}
            />
          </div>
        </section>

        <section className="thera-card thera-span-2">
          <h2>Rendering Claims</h2>

          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>DOS</th>
                  <th>Payer</th>
                  <th>Status</th>
                  <th>Charge</th>
                  <th>Balance</th>
                </tr>
              </thead>

              <tbody>
                {data.renderingClaims.map(
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

                      <td>
                        {shortDate(
                          claim.service_date_from,
                        )}
                      </td>

                      <td>
                        {claim.payerName || "—"}
                      </td>

                      <td>
                        <StatusBadge
                          value={
                            claim.claim_status
                          }
                        />
                      </td>

                      <td>
                        {money(
                          claim.total_charge_cents,
                        )}
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
    </>
  );
}

function Field({
  name,
  value,
}: {
  name: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="thera-field-label">
        {name}
      </div>
      <div className="thera-field-value">
        {value}
      </div>
    </div>
  );
}
