import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { StatusBadge } from "../components/status-badge";
import { buildProviderCredentialingView } from "../domains/credentialing/workflow";
import { tenantSelect, referenceSelect } from "../lib/tenant-data-client";
import { money, shortDate } from "../lib/format";
import { useApi } from "../lib/therassistant-api";

type Row = Record<string, any>;

type Detail = {
  provider: Row;
  appointments: Row[];
  clinicalNotes: Row[];
  charges: Row[];
  renderingClaims: Row[];
  billingClaims: Row[];
  workItems: Row[];
};

type CredentialingView = ReturnType<typeof buildProviderCredentialingView>;

const blankIdentifier = {
  identifier_type: "caqh",
  identifier_value: "",
  payer_id: "",
  effective_date: "",
  termination_date: "",
};

export function ProviderDetailPage() {
  const [, params] = useRoute<{ id: string }>("/providers/:id");
  const providerId = params?.id ?? "";
  const { data, loading, error } = useApi<Detail>(`/api/providers/${providerId}`);
  const [credentialing, setCredentialing] = useState<CredentialingView | null>(null);
  const [credentialingError, setCredentialingError] = useState<string | null>(null);
  const [payers, setPayers] = useState<Row[]>([]);
  const [credentialingVersion, setCredentialingVersion] = useState(0);
  const [showIdentifier, setShowIdentifier] = useState(false);
  const [identifierForm, setIdentifierForm] = useState({ ...blankIdentifier });
  const [savingIdentifier, setSavingIdentifier] = useState(false);

  useEffect(() => {
    if (!providerId) return;
    let active = true;
    setCredentialingError(null);

    Promise.all([
      tenantSelect("provider_identifiers"),
      tenantSelect("provider_payer_enrollments"),
      referenceSelect("payers"),
    ])
      .then(([identifiers, enrollments, payerRows]) => {
        if (!active) return;
        setPayers(payerRows);
        setCredentialing(
          buildProviderCredentialingView({
            providerId,
            identifiers,
            enrollments,
            payers: payerRows,
          }),
        );
      })
      .catch((err: unknown) => {
        if (!active) return;
        setCredentialingError(
          err instanceof Error ? err.message : "Unable to load credentialing data",
        );
      });

    return () => {
      active = false;
    };
  }, [providerId, credentialingVersion]);

  async function saveIdentifier() {
    if (!identifierForm.identifier_type.trim() || !identifierForm.identifier_value.trim()) return;
    setSavingIdentifier(true);
    try {
      const response = await fetch(`/api/providers/${providerId}/identifiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          identifier_type: identifierForm.identifier_type.trim(),
          identifier_value: identifierForm.identifier_value.trim(),
          payer_id: identifierForm.payer_id || null,
          effective_date: identifierForm.effective_date || null,
          termination_date: identifierForm.termination_date || null,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Unable to save identifier (${response.status})`);
      }
      setIdentifierForm({ ...blankIdentifier });
      setShowIdentifier(false);
      setCredentialingVersion((value) => value + 1);
    } catch (err) {
      setCredentialingError(err instanceof Error ? err.message : "Unable to save identifier");
    } finally {
      setSavingIdentifier(false);
    }
  }

  if (loading) return <div className="thera-state">Loading provider...</div>;
  if (error || !data) return <div className="thera-state error">{error || "Provider not found"}</div>;

  const provider = data.provider;
  const enrollments = credentialing?.enrollments ?? [];
  const identifiers = credentialing?.identifiers ?? [];
  const approvedCount = enrollments.filter((row) => row.enrollment_status === "approved").length;
  const revalidationCount = enrollments.filter(
    (row) => row.revalidationState === "due_soon" || row.revalidationState === "overdue",
  ).length;

  return (
    <>
      <div className="thera-breadcrumb">
        <Link href="/providers" className="thera-link">Providers</Link>
        <span>/</span>
        <span>{provider.first_name} {provider.last_name}</span>
      </div>

      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">PROVIDER 360</div>
          <h1>
            {provider.first_name} {provider.last_name}
            {provider.credentials ? `, ${provider.credentials}` : ""}
          </h1>
          <p>NPI {provider.individual_npi || "—"} · Taxonomy {provider.taxonomy_code || "—"}</p>
        </div>
        <StatusBadge value={provider.provider_status} />
      </div>

      {(data.workItems.length > 0 || revalidationCount > 0) && (
        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <h2>Operational Issues</h2>
              <p>Provider issues affecting credentialing and revenue cycle readiness.</p>
            </div>
          </div>
          <div className="thera-stack">
            {enrollments
              .filter((row) => row.revalidationState === "due_soon" || row.revalidationState === "overdue")
              .map((row) => (
                <div className={`thera-alert ${row.revalidationState === "overdue" ? "danger" : "warning"}`} key={`revalidation-${row.id}`}>
                  <div className="thera-row-between">
                    <strong>{row.payerName || "Payer"} revalidation {row.revalidationState === "overdue" ? "overdue" : "due soon"}</strong>
                    <StatusBadge value={row.revalidationState} />
                  </div>
                  <div>Due {shortDate(row.revalidation_due_date)}</div>
                </div>
              ))}
            {data.workItems.map((item) => (
              <div className="thera-alert danger" key={item.id}>
                <div className="thera-row-between">
                  <strong>{item.title}</strong>
                  <StatusBadge value={item.priority} />
                </div>
                <div>{item.description}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {credentialingError && <div className="thera-state error">{credentialingError}</div>}

      <div className="thera-detail-grid">
        <section className="thera-card">
          <h2>Provider Information</h2>
          <div className="thera-definition-grid">
            <Field name="Email" value={provider.email || "—"} />
            <Field name="Phone" value={provider.phone || "—"} />
            <Field name="NPI" value={provider.individual_npi || "—"} />
            <Field name="Taxonomy" value={provider.taxonomy_code || "—"} />
          </div>
        </section>

        <section className="thera-card">
          <h2>Credentialing Summary</h2>
          <div className="thera-definition-grid">
            <Field name="Payer Enrollments" value={enrollments.length} />
            <Field name="Approved" value={approvedCount} />
            <Field name="Revalidation Action" value={revalidationCount} />
            <Field name="Identifiers" value={identifiers.length} />
          </div>
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header">
            <div>
              <h2>Provider Identifiers</h2>
              <p>CAQH, PECOS/PTAN, Medicaid and payer-specific identifiers.</p>
            </div>
            <button type="button" className="thera-action" onClick={() => setShowIdentifier(true)}>+ Add Identifier</button>
          </div>
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead><tr><th>Type</th><th>Identifier</th><th>Payer</th><th>Effective</th><th>Termination</th></tr></thead>
              <tbody>
                {identifiers.length === 0 && <tr><td colSpan={5}>No additional identifiers on file.</td></tr>}
                {identifiers.map((row) => (
                  <tr key={row.id}>
                    <td>{String(row.identifier_type || "—").replaceAll("_", " ").toUpperCase()}</td>
                    <td>{row.identifier_value}</td>
                    <td>{row.payerName || "All Payers"}</td>
                    <td>{shortDate(row.effective_date)}</td>
                    <td>{shortDate(row.termination_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header">
            <div>
              <h2>Payer Enrollments</h2>
              <p>Participation, payer IDs and revalidation dates for this provider.</p>
            </div>
            <Link href="/credentialing" className="thera-action secondary">Open Credentialing</Link>
          </div>
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead><tr><th>Payer</th><th>Status</th><th>Effective</th><th>Revalidation</th><th>Due State</th><th>Payer Provider ID</th></tr></thead>
              <tbody>
                {enrollments.length === 0 && <tr><td colSpan={6}>No payer enrollment records on file.</td></tr>}
                {enrollments.map((row) => (
                  <tr key={row.id}>
                    <td>{row.payerName || "—"}</td>
                    <td><StatusBadge value={row.enrollment_status} /></td>
                    <td>{shortDate(row.effective_date)}</td>
                    <td>{shortDate(row.revalidation_due_date)}</td>
                    <td><StatusBadge value={row.revalidationState} /></td>
                    <td>{row.payer_provider_id || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="thera-card">
          <h2>Activity</h2>
          <div className="thera-definition-grid">
            <Field name="Appointments" value={data.appointments.length} />
            <Field name="Clinical Notes" value={data.clinicalNotes.length} />
            <Field name="Charges" value={data.charges.length} />
            <Field name="Rendering Claims" value={data.renderingClaims.length} />
          </div>
        </section>

        <section className="thera-card thera-span-2">
          <h2>Rendering Claims</h2>
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead><tr><th>Client</th><th>DOS</th><th>Payer</th><th>Status</th><th>Charge</th><th>Balance</th></tr></thead>
              <tbody>
                {data.renderingClaims.map((claim) => (
                  <tr key={claim.id}>
                    <td><Link href={`/claims/${claim.id}`} className="thera-table-link">{claim.clientName}</Link></td>
                    <td>{shortDate(claim.service_date_from)}</td>
                    <td>{claim.payerName || "—"}</td>
                    <td><StatusBadge value={claim.claim_status} /></td>
                    <td>{money(claim.total_charge_cents)}</td>
                    <td>{money(claim.openBalanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showIdentifier && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 1000, padding: 20 }}>
          <section className="thera-card" style={{ width: "min(680px,100%)" }}>
            <div className="thera-card-header">
              <div><h2>Add Provider Identifier</h2><p>Add a credentialing or payer-specific identifier to Provider 360.</p></div>
              <button type="button" className="thera-action secondary" onClick={() => setShowIdentifier(false)}>Close</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
              <label><div className="thera-field-label">Identifier Type</div><select className="thera-input" value={identifierForm.identifier_type} onChange={(event) => setIdentifierForm({ ...identifierForm, identifier_type: event.target.value })}><option value="caqh">CAQH</option><option value="pecos_ptan">PECOS / PTAN</option><option value="medicaid">Medicaid</option><option value="payer_provider_id">Payer Provider ID</option><option value="other">Other</option></select></label>
              <label><div className="thera-field-label">Identifier</div><input className="thera-input" value={identifierForm.identifier_value} onChange={(event) => setIdentifierForm({ ...identifierForm, identifier_value: event.target.value })} /></label>
              <label><div className="thera-field-label">Payer</div><select className="thera-input" value={identifierForm.payer_id} onChange={(event) => setIdentifierForm({ ...identifierForm, payer_id: event.target.value })}><option value="">All Payers / Not Payer-Specific</option>{payers.map((payer) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}</select></label>
              <label><div className="thera-field-label">Effective Date</div><input className="thera-input" type="date" value={identifierForm.effective_date} onChange={(event) => setIdentifierForm({ ...identifierForm, effective_date: event.target.value })} /></label>
              <label><div className="thera-field-label">Termination Date</div><input className="thera-input" type="date" value={identifierForm.termination_date} onChange={(event) => setIdentifierForm({ ...identifierForm, termination_date: event.target.value })} /></label>
            </div>
            <div style={{ marginTop: 16 }}><button type="button" className="thera-action" disabled={savingIdentifier} onClick={() => void saveIdentifier()}>{savingIdentifier ? "Saving..." : "Save Identifier"}</button></div>
          </section>
        </div>
      )}
    </>
  );
}

function Field({ name, value }: { name: string; value: React.ReactNode }) {
  return <div><div className="thera-field-label">{name}</div><div className="thera-field-value">{value}</div></div>;
}
