import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { StatusBadge } from "../components/status-badge";
import { WorkDrawer } from "../components/work-drawer";
import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  type Row,
} from "../lib/tenant-data-client";

type DataRow = Row & { id: string };
type Provider = {
  id: string;
  firstName: string;
  lastName: string;
  credentials?: string | null;
  providerStatus: string;
  individualNpi?: string | null;
  taxonomyCode?: string | null;
  email?: string | null;
  phone?: string | null;
  claimCount: number;
  openIssueCount: number;
};
type ProviderForm = {
  id?: string;
  first_name: string;
  last_name: string;
  credentials: string;
  provider_status: string;
  individual_npi: string;
  taxonomy_code: string;
  email: string;
  phone: string;
};

const blank: ProviderForm = {
  first_name: "",
  last_name: "",
  credentials: "",
  provider_status: "active",
  individual_npi: "",
  taxonomy_code: "",
  email: "",
  phone: "",
};

const activeWorkStatuses = new Set(["open", "in_progress", "pending", "snoozed", "reopened"]);

function mapProvider(row: DataRow, claims: DataRow[], work: DataRow[]): Provider {
  const providerClaims = claims.filter(
    (claim) =>
      claim.rendering_provider_id === row.id ||
      claim.billing_provider_id === row.id,
  );
  const claimIds = new Set(providerClaims.map((claim) => claim.id));
  const openIssueCount = work.filter((item) => {
    if (!activeWorkStatuses.has(String(item.workqueue_status ?? ""))) return false;
    if (
      String(item.source_object_type ?? "") === "provider" &&
      String(item.source_object_id ?? "") === row.id
    ) return true;
    return claimIds.has(String(item.source_object_id ?? ""));
  }).length;

  return {
    id: row.id,
    firstName: String(row.first_name ?? ""),
    lastName: String(row.last_name ?? ""),
    credentials: row.credentials ? String(row.credentials) : null,
    providerStatus: String(row.provider_status ?? "active"),
    individualNpi: row.individual_npi ? String(row.individual_npi) : null,
    taxonomyCode: row.taxonomy_code ? String(row.taxonomy_code) : null,
    email: row.email ? String(row.email) : null,
    phone: row.phone ? String(row.phone) : null,
    claimCount: providerClaims.length,
    openIssueCount,
  };
}

export function ProvidersPage() {
  const [, navigate] = useLocation();
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState<ProviderForm | null>(null);
  const [baseline, setBaseline] = useState<ProviderForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(
    () => Boolean(form && baseline && JSON.stringify(form) !== JSON.stringify(baseline)),
    [form, baseline],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      tenantSelect<DataRow>("providers", { order: "last_name.asc,first_name.asc" }),
      tenantSelect<DataRow>("professional_claims"),
      tenantSelect<DataRow>("workqueue_items"),
    ])
      .then(([providerRows, claims, work]) => {
        if (!active) return;
        setProviders(providerRows.map((row) => mapProvider(row, claims, work)));
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to load providers.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [version]);

  function openForm(next: ProviderForm) {
    setForm(next);
    setBaseline({ ...next });
  }

  function edit(provider: Provider) {
    openForm({
      id: provider.id,
      first_name: provider.firstName,
      last_name: provider.lastName,
      credentials: provider.credentials || "",
      provider_status: provider.providerStatus,
      individual_npi: provider.individualNpi || "",
      taxonomy_code: provider.taxonomyCode || "",
      email: provider.email || "",
      phone: provider.phone || "",
    });
  }

  async function save() {
    if (!form?.first_name.trim() || !form.last_name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        credentials: form.credentials || null,
        provider_status: form.provider_status,
        individual_npi: form.individual_npi || null,
        taxonomy_code: form.taxonomy_code || null,
        email: form.email || null,
        phone: form.phone || null,
      };
      if (form.id) await tenantUpdate("providers", form.id, payload);
      else await tenantInsert("providers", payload);
      setForm(null);
      setBaseline(null);
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save provider.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">OPERATE · PROVIDER OPERATIONS</div>
          <h1>Providers</h1>
          <p>
            Provider identity, clinical activity, billing activity, credentialing readiness,
            and payer-related operational issues from the live tenant record.
          </p>
        </div>
        <button type="button" className="thera-action" onClick={() => openForm({ ...blank })}>
          + Add Provider
        </button>
      </div>

      <section className="thera-card">
        {loading && <div className="thera-state">Loading providers...</div>}
        {error && <div className="thera-state error">{error}</div>}
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((provider) => (
                  <tr key={provider.id}>
                    <td>
                      <Link href={`/providers/${provider.id}`} className="thera-table-link">
                        {provider.firstName} {provider.lastName}
                        {provider.credentials ? `, ${provider.credentials}` : ""}
                      </Link>
                      <div className="thera-table-subtext">{provider.email || ""}</div>
                    </td>
                    <td>{provider.individualNpi || "—"}</td>
                    <td>{provider.taxonomyCode || "—"}</td>
                    <td><StatusBadge value={provider.providerStatus} /></td>
                    <td>{provider.claimCount}</td>
                    <td>
                      {provider.openIssueCount > 0
                        ? <StatusBadge value="needs review" />
                        : "0"}
                    </td>
                    <td>
                      <button type="button" className="thera-action secondary" onClick={() => edit(provider)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {providers.length === 0 && (
                  <tr><td colSpan={7}><div className="thera-empty">No providers on file.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {form && (
        <WorkDrawer
          open={Boolean(form)}
          onOpenChange={(open) => {
            if (!open) {
              setForm(null);
              setBaseline(null);
            }
          }}
          dirty={dirty}
          title={form.id ? "Edit Provider" : "Add Provider"}
          subtitle={
            form.id
              ? `${form.first_name} ${form.last_name}${form.credentials ? `, ${form.credentials}` : ""}`
              : "Create a provider record"
          }
          openFullRecord={form.id ? () => navigate(`/providers/${form.id}`) : undefined}
          openFullRecordLabel="Open Provider Detail"
          footer={
            <div className="thera-filter-row" style={{ justifyContent: "space-between" }}>
              <button
                type="button"
                className="thera-action secondary"
                onClick={() => {
                  setForm(null);
                  setBaseline(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="thera-action"
                disabled={saving || !form.first_name.trim() || !form.last_name.trim()}
                onClick={() => void save()}
              >
                {saving ? "Saving..." : "Save Provider"}
              </button>
            </div>
          }
        >
          <div className="thera-form-grid">
            <label>First Name<input className="thera-input" value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} /></label>
            <label>Last Name<input className="thera-input" value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} /></label>
            <label>Credentials<input className="thera-input" value={form.credentials} onChange={(event) => setForm({ ...form, credentials: event.target.value })} /></label>
            <label>Status<select className="thera-input" value={form.provider_status} onChange={(event) => setForm({ ...form, provider_status: event.target.value })}><option value="active">Active</option><option value="pending">Pending</option><option value="inactive">Inactive</option><option value="on_leave">On Leave</option><option value="terminated">Terminated</option></select></label>
            <label>NPI<input className="thera-input" value={form.individual_npi} onChange={(event) => setForm({ ...form, individual_npi: event.target.value })} /></label>
            <label>Taxonomy<input className="thera-input" value={form.taxonomy_code} onChange={(event) => setForm({ ...form, taxonomy_code: event.target.value })} /></label>
            <label>Email<input className="thera-input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <label>Phone<input className="thera-input" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
          </div>
        </WorkDrawer>
      )}
    </>
  );
}
