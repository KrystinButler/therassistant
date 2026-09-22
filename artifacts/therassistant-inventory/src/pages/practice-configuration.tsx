import { useEffect, useState } from "react";

import {
  getCurrentTenantId,
  referenceSelect,
  tenantInsert,
  tenantRpc,
  tenantSelect,
  tenantUpdate,
  type Row,
} from "../lib/tenant-data-client";
import {
  read837PConfig,
} from "../domains/billing/claim-output-repository";
import {
  CLAIM_FILING_INDICATORS,
  type Edi837PConfig,
} from "../domains/billing/claim-output";

type DataRow = Row & { id: string };
type PayerRow = DataRow & {
  name?: string;
  payer_type?: string | null;
  clearinghouse_payer_id?: string | null;
};

export function PracticeConfigurationPage() {
  const [tenantId, setTenantId] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [payers, setPayers] = useState<PayerRow[]>([]);
  const [form, setForm] = useState<Edi837PConfig | null>(null);
  const [practiceEntityId, setPracticeEntityId] = useState("");
  const [practiceLocationId, setPracticeLocationId] = useState("");
  const [locationName, setLocationName] = useState("");
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
        const [tenants, payerRows, entityRows, locationRows] = await Promise.all([
          referenceSelect<DataRow>("tenants", {
            id: `eq.${currentTenantId}`,
            limit: "1",
          }),
          referenceSelect<PayerRow>("payers", { order: "name.asc" }),
          tenantSelect<DataRow>("practice_entities", { status: "eq.active", order: "created_at.asc" }),
          tenantSelect<DataRow>("practice_locations", { status: "eq.active", order: "is_primary.desc,created_at.asc" }),
        ]);
        if (!active) return;
        setTenantId(currentTenantId);
        const currentTenantName = String(tenants[0]?.name ?? "Practice");
        setTenantName(currentTenantName);
        const entity = entityRows[0] ?? null;
        const location = locationRows.find((row) => String(row.practice_entity_id ?? "") === String(entity?.id ?? "")) ?? locationRows[0] ?? null;
        setPracticeEntityId(String(entity?.id ?? ""));
        setPracticeLocationId(String(location?.id ?? ""));
        setLocationName(String(location?.name ?? `${currentTenantName} Primary Location`));
        const config = read837PConfig(tenants[0]?.settings);
        const payerIds = { ...config.payerIds };
        for (const payer of payerRows) {
          if (!payerIds[payer.id] && payer.clearinghouse_payer_id) {
            payerIds[payer.id] = String(payer.clearinghouse_payer_id);
          }
        }
        setForm({
          ...config,
          billingProviderName: config.billingProviderName || String(entity?.legal_name ?? entity?.dba_name ?? ""),
          billingProviderNpi: config.billingProviderNpi || String(entity?.group_npi ?? ""),
          billingProviderTaxId: config.billingProviderTaxId || String(entity?.tax_id ?? ""),
          billingProviderTaxonomy: config.billingProviderTaxonomy || String(entity?.taxonomy_code ?? ""),
          addressLine1: config.addressLine1 || String(location?.address_line1 ?? ""),
          addressLine2: config.addressLine2 || String(location?.address_line2 ?? ""),
          city: config.city || String(location?.city ?? ""),
          state: config.state || String(location?.state ?? ""),
          postalCode: config.postalCode || String(location?.postal_code ?? ""),
          contactPhone: config.contactPhone || String(location?.phone ?? ""),
          payerIds,
        });
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

  function updateClaimFilingIndicator(payerId: string, value: string) {
    if (!form) return;
    setForm({
      ...form,
      claimFilingIndicators: {
        ...form.claimFilingIndicators,
        [payerId]: value,
      },
    });
  }

  function updateEraPayerIdentifier(payerId: string, value: string) {
    if (!form) return;
    setForm({
      ...form,
      eraPayerIdentifiers: {
        ...form.eraPayerIdentifiers,
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
        claimFilingIndicators: Object.fromEntries(
          Object.entries(form.claimFilingIndicators)
            .map(([key, value]) => [key, value.trim().toUpperCase()])
            .filter(([, value]) => Boolean(value)),
        ),
        eraPayerIdentifiers: Object.fromEntries(
          Object.entries(form.eraPayerIdentifiers)
            .map(([key, value]) => [key, value.trim()])
            .filter(([, value]) => Boolean(value)),
        ),
      };
      await tenantRpc("update_claims_edi_settings", {
        p_tenant_id: tenantId,
        p_config: normalized,
      });

      let entityId = practiceEntityId;
      if (normalized.billingProviderName.trim()) {
        const entityPayload = {
          legal_name: normalized.billingProviderName.trim(),
          tax_id: normalized.billingProviderTaxId || null,
          group_npi: normalized.billingProviderNpi || null,
          taxonomy_code: normalized.billingProviderTaxonomy.trim() || null,
          status: "active",
        };
        const entity = entityId
          ? await tenantUpdate<DataRow>("practice_entities", entityId, entityPayload)
          : await tenantInsert<DataRow>("practice_entities", entityPayload);
        entityId = entity.id;
        setPracticeEntityId(entity.id);

        const locationPayload = {
          practice_entity_id: entity.id,
          name: locationName.trim() || `${normalized.billingProviderName.trim()} Primary Location`,
          location_type: "office",
          address_line1: normalized.addressLine1.trim() || null,
          address_line2: normalized.addressLine2?.trim() || null,
          city: normalized.city.trim() || null,
          state: normalized.state.trim() || null,
          postal_code: normalized.postalCode.trim() || null,
          phone: normalized.contactPhone.trim() || null,
          location_npi: normalized.billingProviderNpi || null,
          taxonomy_code: normalized.billingProviderTaxonomy.trim() || null,
          is_primary: true,
          status: "active",
        };
        const location = practiceLocationId
          ? await tenantUpdate<DataRow>("practice_locations", practiceLocationId, locationPayload)
          : await tenantInsert<DataRow>("practice_locations", locationPayload);
        setPracticeLocationId(location.id);
        setLocationName(String(location.name ?? locationName));
      }

      setForm(normalized);
      setMessage(
        normalized.billingProviderName.trim()
          ? "Practice configuration, entity, and primary location saved."
          : "837P configuration saved. Add a billing provider/legal name to create the practice entity and primary location required for patient intake.",
      );
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
              <div className="thera-eyebrow">PATIENT INTAKE PREREQUISITE</div>
              <h2>Practice Setup Status</h2>
              <p>Patients can be added only after an active practice entity, active provider, and linked active practice location exist.</p>
            </div>
          </div>
          <div className="thera-definition-grid">
            <div><div className="thera-field-label">Practice Entity</div><div className="thera-field-value">{practiceEntityId ? "Ready" : "Required"}</div></div>
            <div><div className="thera-field-label">Primary Location</div><div className="thera-field-value">{practiceLocationId ? "Ready" : "Required"}</div></div>
            <div><div className="thera-field-label">Provider</div><div className="thera-field-value">Manage on Providers page</div></div>
          </div>
        </section>

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
              <h2>Practice Entity & Primary Location</h2>
              <p>This setup creates the active practice entity and linked primary location required before patient intake, and supplies the billing-provider data used for 837P claims.</p>
            </div>
          </div>
          <div className="thera-form-grid">
            <Input label="Practice Entity / Legal Name" value={form.billingProviderName} onChange={(value) => update("billingProviderName", value)} />
            <Input label="Primary Location Name" value={locationName} onChange={setLocationName} />
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
              <h2>Payer Claim Configuration</h2>
              <p>Configure outbound 837P routing separately from the inbound ERA payer identifier. THERASSISTANT will not assume these identifiers are the same.</p>
            </div>
          </div>
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead><tr><th>Payer</th><th>Type</th><th>837P Payer ID</th><th>Claim Filing Indicator</th><th>ERA Payer ID</th></tr></thead>
              <tbody>
                {payers.map((payer) => (
                  <tr key={payer.id}>
                    <td>{String(payer.name ?? payer.id)}</td>
                    <td>{String(payer.payer_type ?? "—").replaceAll("_", " ")}</td>
                    <td>
                      <input
                        className="thera-input"
                        value={form.payerIds[payer.id] ?? ""}
                        onChange={(event) => updatePayerId(payer.id, event.target.value)}
                        aria-label={`${String(payer.name ?? "Payer")} EDI payer ID`}
                      />
                    </td>
                    <td>
                      <select
                        className="thera-input"
                        value={form.claimFilingIndicators[payer.id] ?? ""}
                        onChange={(event) => updateClaimFilingIndicator(payer.id, event.target.value)}
                        aria-label={`${String(payer.name ?? "Payer")} claim filing indicator`}
                      >
                        <option value="">Select</option>
                        {CLAIM_FILING_INDICATORS.map(([code, label]) => (
                          <option key={code} value={code}>{code} — {label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="thera-input"
                        value={form.eraPayerIdentifiers[payer.id] ?? ""}
                        onChange={(event) => updateEraPayerIdentifier(payer.id, event.target.value)}
                        aria-label={`${String(payer.name ?? "Payer")} ERA payer ID`}
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
