import { useEffect, useState } from "react";

import {
  getCurrentTenantId,
  referenceSelect,
  tenantRpc,
  type Row,
} from "../lib/tenant-data-client";
import {
  read837PConfig,
} from "../domains/billing/claim-output-repository";
import type { Edi837PConfig } from "../domains/billing/claim-output";

type DataRow = Row & { id: string };
type PayerRow = DataRow & { name?: string; clearinghouse_payer_id?: string | null };

export function PracticeConfigurationPage() {
  const [tenantId, setTenantId] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [payers, setPayers] = useState<PayerRow[]>([]);
  const [form, setForm] = useState<Edi837PConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const currentTenantId = await getCurrentTenantId();
        const [tenants, payerRows] = await Promise.all([
          referenceSelect<DataRow>("tenants", {
            id: `eq.${currentTenantId}`,
            limit: "1",
          }),
          referenceSelect<PayerRow>("payers", { order: "name.asc" }),
        ]);
        if (!active) return;
        setTenantId(currentTenantId);
        setTenantName(String(tenants[0]?.name ?? "Practice"));
        const config = read837PConfig(tenants[0]?.settings);
        const payerIds = { ...config.payerIds };
        for (const payer of payerRows) {
          if (!payerIds[payer.id] && payer.clearinghouse_payer_id) {
            payerIds[payer.id] = String(payer.clearinghouse_payer_id);
          }
        }
        setForm({ ...config, payerIds });
        setPayers(payerRows);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load practice configuration.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  function update<K extends keyof Edi837PConfig>(key: K, value: Edi837PConfig[K]) {
    setForm((current) => current ? { ...current, [key]: value } : current);
  }

  function updatePayerId(payerId: string, value: string) {
    if (!form) return;
    setForm({
      ...form,
      payerIds: {
        ...form.payerIds,
        [payerId]: value,
      },
    });
  }

  async function save() {
    if (!form || !tenantId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const normalized: Edi837PConfig = {
        ...form,
        state: form.state.trim().toUpperCase(),
        billingProviderNpi: form.billingProviderNpi.replace(/\D/g, ""),
        billingProviderTaxId: form.billingProviderTaxId.replace(/\D/g, ""),
        postalCode: form.postalCode.replace(/[^0-9-]/g, ""),
        contactPhone: form.contactPhone.replace(/[^0-9+]/g, ""),
        payerIds: Object.fromEntries(
          Object.entries(form.payerIds)
            .map(([key, value]) => [key, value.trim()])
            .filter(([, value]) => Boolean(value)),
        ),
      };
      await tenantRpc("update_claims_edi_settings", {
        p_tenant_id: tenantId,
        p_config: normalized,
      });
      setForm(normalized);
      setMessage("837P practice configuration saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save claims EDI configuration.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="thera-state">Loading practice configuration...</div>;
  if (error && !form) return <div className="thera-state error">{error}</div>;
  if (!form) return <div className="thera-state error">Practice configuration is unavailable.</div>;

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">ADMINISTRATION</div>
          <h1>Practice Configuration</h1>
          <p>{tenantName} · configure the data required for professional claim export.</p>
        </div>
        <button type="button" className="thera-action" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving..." : "Save Configuration"}
        </button>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="thera-stack">
        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <h2>837P Trading Partner</h2>
              <p>Use the submitter and receiver identifiers assigned for your clearinghouse connection.</p>
            </div>
          </div>
          <div className="thera-form-grid">
            <Input label="Submitter Name" value={form.submitterName} onChange={(value) => update("submitterName", value)} />
            <Input label="Submitter ID" value={form.submitterId} onChange={(value) => update("submitterId", value)} />
            <Input label="Receiver / Clearinghouse Name" value={form.receiverName} onChange={(value) => update("receiverName", value)} />
            <Input label="Receiver / Clearinghouse ID" value={form.receiverId} onChange={(value) => update("receiverId", value)} />
            <Input label="EDI Contact Name" value={form.contactName} onChange={(value) => update("contactName", value)} />
            <Input label="EDI Contact Phone" value={form.contactPhone} onChange={(value) => update("contactPhone", value)} />
            <Input label="EDI Contact Email" type="email" value={form.contactEmail} onChange={(value) => update("contactEmail", value)} />
            <label className="thera-field">
              <span className="thera-field-label">Usage Indicator</span>
              <select className="thera-input" value={form.usageIndicator} onChange={(event) => update("usageIndicator", event.target.value as "P" | "T")}>
                <option value="T">Test</option>
                <option value="P">Production</option>
              </select>
            </label>
          </div>
        </section>

        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <h2>Billing Provider</h2>
              <p>Organization information used in the billing-provider loop of the 837P export.</p>
            </div>
          </div>
          <div className="thera-form-grid">
            <Input label="Billing Provider / Legal Name" value={form.billingProviderName} onChange={(value) => update("billingProviderName", value)} />
            <Input label="Billing Provider NPI" value={form.billingProviderNpi} onChange={(value) => update("billingProviderNpi", value)} />
            <Input label="Federal Tax ID / EIN" value={form.billingProviderTaxId} onChange={(value) => update("billingProviderTaxId", value)} />
            <Input label="Billing Taxonomy" value={form.billingProviderTaxonomy} onChange={(value) => update("billingProviderTaxonomy", value)} />
            <Input label="Address Line 1" value={form.addressLine1} onChange={(value) => update("addressLine1", value)} />
            <Input label="Address Line 2" value={form.addressLine2 || ""} onChange={(value) => update("addressLine2", value)} />
            <Input label="City" value={form.city} onChange={(value) => update("city", value)} />
            <Input label="State" value={form.state} onChange={(value) => update("state", value)} />
            <Input label="ZIP Code" value={form.postalCode} onChange={(value) => update("postalCode", value)} />
          </div>
        </section>

        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <h2>Payer EDI IDs</h2>
              <p>Override or add the payer ID required by your clearinghouse. Existing reference IDs are prefilled when available.</p>
            </div>
          </div>
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead><tr><th>Payer</th><th>837P Payer ID</th></tr></thead>
              <tbody>
                {payers.map((payer) => (
                  <tr key={payer.id}>
                    <td>{String(payer.name ?? payer.id)}</td>
                    <td>
                      <input
                        className="thera-input"
                        value={form.payerIds[payer.id] ?? ""}
                        onChange={(event) => updatePayerId(payer.id, event.target.value)}
                        aria-label={`${String(payer.name ?? "Payer")} EDI payer ID`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="thera-muted">
          Production use still requires clearinghouse enrollment, companion-guide testing, and acceptance of your trading-partner identifiers. THERASSISTANT does not mark a claim submitted merely because an 837P file is exported.
        </div>
      </div>
    </>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="thera-field">
      <span className="thera-field-label">{label}</span>
      <input className="thera-input" type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
