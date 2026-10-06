import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useRoute } from "wouter";

import { StatusBadge } from "../components/status-badge";
import { money, shortDate } from "../lib/format";
import { referenceSelect, tenantSelect } from "../lib/tenant-data-client";

type Row = Record<string, any>;

type ProviderDetail = {
  provider: Row;
  appointments: Row[];
  clinicalNotes: Row[];
  charges: Row[];
  renderingClaims: Row[];
  billingClaims: Row[];
  workItems: Row[];
};

const activeWorkStatuses = new Set(["open", "in_progress", "pending", "snoozed", "reopened"]);

export function ProviderDetailPage() {
  const [, params] = useRoute<{ id: string }>("/providers/:id");
  const providerId = params?.id ?? "";
  const [data, setData] = useState<ProviderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!providerId) return;
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      tenantSelect("providers", { id: `eq.${providerId}` }),
      tenantSelect("appointments", { provider_id: `eq.${providerId}`, order: "starts_at.desc" }),
      tenantSelect("clinical_notes", { provider_id: `eq.${providerId}`, order: "service_date.desc" }),
      tenantSelect("charge_capture_items", { provider_id: `eq.${providerId}`, order: "service_date.desc" }),
      tenantSelect("professional_claims", { rendering_provider_id: `eq.${providerId}`, order: "service_date_from.desc" }),
      tenantSelect("professional_claims", { billing_provider_id: `eq.${providerId}`, order: "service_date_from.desc" }),
      tenantSelect("claim_balance_summaries"),
      tenantSelect("clients"),
      referenceSelect("payers"),
      tenantSelect("workqueue_items", { order: "created_at.desc" }),
    ])
      .then(([providerRows, appointments, notes, charges, renderingClaims, billingClaims, balances, clients, payers, workItems]) => {
        if (!active) return;
        const provider = providerRows[0];
        if (!provider) {
          setData(null);
          setError("Provider not found");
          return;
        }

        const clientById = new Map(clients.map((row) => [String(row.id), row]));
        const payerById = new Map(payers.map((row) => [String(row.id), row]));
        const balanceByClaimId = new Map(balances.map((row) => [String(row.claim_id), row]));
        const withClient = (row: Row) => {
          const client = clientById.get(String(row.client_id ?? ""));
          return {
            ...row,
            clientName: client
              ? [client.first_name, client.last_name].filter(Boolean).join(" ")
              : "—",
          };
        };
        const withClaimContext = (row: Row) => {
          const payer = payerById.get(String(row.payer_id ?? ""));
          const balance = balanceByClaimId.get(String(row.id ?? ""));
          return {
            ...withClient(row),
            payerName: payer?.name ?? "—",
            openBalanceCents: Number(balance?.open_balance_cents ?? row.total_charge_cents ?? 0),
          };
        };

        const claimIds = new Set([
          ...renderingClaims.map((row) => String(row.id)),
          ...billingClaims.map((row) => String(row.id)),
        ]);
        const noteIds = new Set(notes.map((row) => String(row.id)));
        const coreWorkItems = workItems.filter((item) => {
          if (!activeWorkStatuses.has(String(item.workqueue_status ?? ""))) return false;
          if (String(item.workqueue_type ?? "") === "credentialing_issue") return false;
          const sourceId = String(item.source_object_id ?? "");
          return sourceId === providerId || claimIds.has(sourceId) || noteIds.has(sourceId);
        });

        setData({
          provider,
          appointments: appointments.map(withClient),
          clinicalNotes: notes.map(withClient),
          charges: charges.map((row) => ({
            ...withClient(row),
            payerName: payerById.get(String(row.payer_id ?? ""))?.name ?? "—",
          })),
          renderingClaims: renderingClaims.map(withClaimContext),
          billingClaims: billingClaims.map(withClaimContext),
          workItems: coreWorkItems,
        });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Unable to load provider.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [providerId]);

  const claims = useMemo(() => {
    if (!data) return [];
    const unique = new Map<string, Row>();
    for (const claim of [...data.renderingClaims, ...data.billingClaims]) {
      unique.set(String(claim.id), claim);
    }
    return [...unique.values()].sort((a, b) =>
      String(b.service_date_from ?? "").localeCompare(String(a.service_date_from ?? "")),
    );
  }, [data]);

  if (loading) return <div className="thera-state">Loading provider...</div>;
  if (error || !data) return <div className="thera-state error">{error || "Provider not found"}</div>;

  const provider = data.provider;
  const displayNpi = provider.individual_npi || provider.npi || "—";

  return (
    <>
      <div className="thera-breadcrumb">
        <Link href="/providers" className="thera-link">Providers</Link>
        <span>/</span>
        <span>{provider.first_name} {provider.last_name}</span>
      </div>

      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">EHR · PROVIDER IDENTITY</div>
          <h1>
            {provider.first_name} {provider.last_name}
            {provider.credentials ? `, ${provider.credentials}` : ""}
          </h1>
          <p>NPI {displayNpi} · Taxonomy {provider.taxonomy_code || "—"}</p>
        </div>
        <div className="thera-filter-row">
          <StatusBadge value={provider.provider_status} />
          <Link href={`/credentialing?provider=${encodeURIComponent(providerId)}`} className="thera-action secondary">
            Open Credentialing Module
          </Link>
        </div>
      </div>

      {data.workItems.length > 0 && (
        <section className="thera-card" style={{ marginBottom: 14 }}>
          <div className="thera-card-header">
            <div>
              <h2>EHR Work Items</h2>
              <p>Clinical, claim, and billing work associated with this provider. Credentialing work stays in the Credentialing module.</p>
            </div>
          </div>
          <div className="thera-stack">
            {data.workItems.slice(0, 8).map((item) => (
              <div className="thera-alert" key={item.id}>
                <div className="thera-row-between">
                  <strong>{item.title || "Work item"}</strong>
                  <StatusBadge value={item.priority || item.workqueue_status} />
                </div>
                {item.description ? <div>{item.description}</div> : null}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="thera-metric-grid" style={{ marginBottom: 14 }}>
        <div className="thera-metric-card"><div className="thera-metric-label">Appointments</div><div className="thera-metric-value">{data.appointments.length}</div></div>
        <div className="thera-metric-card"><div className="thera-metric-label">Clinical Notes</div><div className="thera-metric-value">{data.clinicalNotes.length}</div></div>
        <div className="thera-metric-card"><div className="thera-metric-label">Charges</div><div className="thera-metric-value">{data.charges.length}</div></div>
        <div className="thera-metric-card"><div className="thera-metric-label">Claims</div><div className="thera-metric-value">{claims.length}</div></div>
      </div>

      <div className="thera-detail-grid">
        <section className="thera-card">
          <h2>Provider Information</h2>
          <div className="thera-definition-grid">
            <Field name="Email" value={provider.email || "—"} />
            <Field name="Phone" value={provider.phone || "—"} />
            <Field name="NPI" value={displayNpi} />
            <Field name="Taxonomy" value={provider.taxonomy_code || "—"} />
            <Field name="Role" value={provider.role || provider.provider_type || "—"} />
            <Field name="Status" value={provider.provider_status || "—"} />
          </div>
        </section>

        <section className="thera-card">
          <h2>Credentialing Boundary</h2>
          <p>
            Enrollment, payer participation, CAQH, licenses, contracts, directory verification,
            effective dates, and revalidation are maintained in the Credentialing module.
          </p>
          <Link href={`/credentialing?provider=${encodeURIComponent(providerId)}`} className="thera-action secondary">
            Open Provider Credentialing
          </Link>
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header"><div><h2>Recent Appointments</h2><p>Scheduling activity for this provider.</p></div></div>
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead><tr><th>Date</th><th>Client</th><th>Service</th><th>Status</th></tr></thead>
              <tbody>
                {data.appointments.slice(0, 10).map((row) => (
                  <tr key={row.id}>
                    <td>{shortDate(row.starts_at)}</td>
                    <td>{row.clientName}</td>
                    <td>{row.service_type || row.cpt_code || "—"}</td>
                    <td><StatusBadge value={row.appointment_status || "scheduled"} /></td>
                  </tr>
                ))}
                {!data.appointments.length && <tr><td colSpan={4}>No appointments found.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header"><div><h2>Claims</h2><p>Claims rendered or billed under this provider identity.</p></div></div>
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead><tr><th>DOS</th><th>Client</th><th>Payer</th><th>Status</th><th>Charge</th><th>Open Balance</th></tr></thead>
              <tbody>
                {claims.slice(0, 15).map((claim) => (
                  <tr key={claim.id}>
                    <td><Link className="thera-table-link" href={`/claims/${claim.id}`}>{shortDate(claim.service_date_from)}</Link></td>
                    <td>{claim.clientName}</td>
                    <td>{claim.payerName}</td>
                    <td><StatusBadge value={claim.claim_status} /></td>
                    <td>{money(Number(claim.total_charge_cents ?? 0))}</td>
                    <td>{money(Number(claim.openBalanceCents ?? 0))}</td>
                  </tr>
                ))}
                {!claims.length && <tr><td colSpan={6}>No claims found.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function Field({ name, value }: { name: string; value: ReactNode }) {
  return (
    <div>
      <div className="thera-field-label">{name}</div>
      <div>{value}</div>
    </div>
  );
}
