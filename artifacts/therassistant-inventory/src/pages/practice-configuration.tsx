import { WorkDrawer } from "../components/work-drawer";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { resolvePayerEdiConfig } from "../domains/billing/payer-edi-defaults";
import { OfficeAllyConnectionPanel } from "../domains/edi/OfficeAllyConnectionPanel";

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
  type Edi837PConfig,
} from "../domains/billing/claim-output";

type DataRow = Row & { id: string };
type PayerRow = DataRow & {
  name?: string;
  payer_type?: string | null;
  clearinghouse_payer_id?: string | null;
};

export function PracticeConfigurationPage() {
  const [drawer, setDrawer] = useState<"entity" | "location" | "payers" | null>(null);
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

  async function save() {
    if (!form || !tenantId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const normalized: Edi837PConfig = resolvePayerEdiConfig({
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
      }, payers);
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
          ? "Practice configuration, entity, and primary location saved. Office Ally routing remains preconfigured; connect the practice account separately below."
          : "Practice configuration saved. Add a billing provider/legal name to create the practice entity and primary location required for patient intake.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save practice configuration.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="thera-state">Loading practice configuration...</div>;
  if (error && !form) return <div className="thera-state error">{error}</div>;
  if (!form) return <div className="thera-state error">Practice configuration is unavailable.</div>;

  const routing = resolvePayerEdiConfig(form, payers);
  const readyOutboundCount = payers.filter((payer) => Boolean(routing.payerIds[payer.id])).length;

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">ADMINISTRATION</div>
          <h1>Practice Configuration</h1>
          <p>{tenantName} · Office Ally routing is preconfigured by THERASSISTANT. Connect this practice's Office Ally account once, then maintain only practice and payer data.</p>
        </div>
        <button type="button" className="thera-action" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving..." : "Save Configuration"}
        </button>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      <OfficeAllyConnectionPanel />

      <div className="thera-filter-row">{([['entity', 'Practice Entity'], ['location', 'Location Setup'], ['payers', 'Payers']] as const).map(([key,label]) => <button key={key} type="button" className="thera-action secondary" onClick={() => setDrawer(key)}>{label}</button>)}</div>
      <WorkDrawer open={drawer !== null} onOpenChange={open => { if (!open) setDrawer(null); }} title={drawer === "entity" ? "Practice Entity" : drawer === "location" ? "Location Setup" : "Payers"} footer={<button className="thera-action" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Settings"}</button>}>
        {error && <div className="thera-state error">{error}</div>}{message && <div role="status">{message}</div>}
        {drawer === "entity" && (<div className="thera-form-grid"><Input label="Practice Entity / Legal Name" value={form.billingProviderName} onChange={value => update("billingProviderName", value)} /><Input label="Billing Provider NPI" value={form.billingProviderNpi} onChange={value => update("billingProviderNpi", value)} /><Input label="Federal Tax ID / EIN" value={form.billingProviderTaxId} onChange={value => update("billingProviderTaxId", value)} /><Input label="Billing Taxonomy" value={form.billingProviderTaxonomy} onChange={value => update("billingProviderTaxonomy", value)} /></div>)}
        {drawer === "location" && (<div className="thera-form-grid"><Input label="Location Name" value={locationName} onChange={setLocationName} /><Input label="Address Line 1" value={form.addressLine1 || ""} onChange={value => update("addressLine1", value)} /><Input label="Address Line 2" value={form.addressLine2 || ""} onChange={value => update("addressLine2", value)} /><Input label="City" value={form.city || ""} onChange={value => update("city", value)} /><Input label="State" value={form.state || ""} onChange={value => update("state", value)} /><Input label="ZIP Code" value={form.postalCode || ""} onChange={value => update("postalCode", value)} /><Input label="Phone" value={form.contactPhone || ""} onChange={value => update("contactPhone", value)} /></div>)}
        {drawer === "payers" && (        <section className="thera-card" aria-labelledby="colorado-payer-routing">
          <div className="thera-card-header split">
            <div>
              <div className="thera-eyebrow">SHARED COLORADO REFERENCE</div>
              <h2 id="colorado-payer-routing">Colorado Payer Claim Routing</h2>
              <p>Claim-filing categories and available payer IDs are loaded automatically from the shared catalog. Office Ally technical routing is centrally maintained; this practice uses the connection shown above. Outbound 837P and inbound ERA identifiers remain separate.</p>
            </div>
            <span className="thera-table-subtext">{readyOutboundCount} of {payers.length} outbound payer IDs available</span>
          </div>
          {readyOutboundCount < payers.length && (
            <div className="thera-alert" role="status" style={{ marginBottom: 12 }}>
              {payers.length - readyOutboundCount} payer ID{payers.length - readyOutboundCount === 1 ? "" : "s"} not yet loaded in the shared catalog. Those Office Ally payer routes need central verification; they are not invented or marked ready.
            </div>
          )}
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead><tr><th>Payer</th><th>Claim Filing</th><th>837P Routing ID</th><th>ERA Identifier</th><th>Catalog Status</th></tr></thead>
              <tbody>
                {payers.map((payer) => {
                  const filing = routing.claimFilingIndicators[payer.id] ?? "";
                  const outbound = routing.payerIds[payer.id] ?? "";
                  const inbound = routing.eraPayerIdentifiers[payer.id] ?? "";
                  return <tr key={payer.id}>
                    <td><Link className="thera-table-link" href={"/payers/" + payer.id}>{String(payer.name ?? "Payer")}</Link></td>
                    <td>{filing || "Needs classification"}<div className="thera-table-subtext">{form.claimFilingIndicators[payer.id] ? "Existing payer override" : filing ? "Colorado catalog default" : "No safe category default"}</div></td>
                    <td><input aria-label={`837P routing ID for ${payer.name}`} className="thera-input" value={form.payerIds[payer.id] ?? outbound} onChange={e => update("payerIds", { ...form.payerIds, [payer.id]: e.target.value })} /><div className="thera-table-subtext">{form.payerIds[payer.id] ? "Existing payer override" : outbound ? "Shared reference value" : "Awaiting Office Ally payer mapping"}</div></td>
                    <td><input aria-label={`ERA identifier for ${payer.name}`} className="thera-input" value={form.eraPayerIdentifiers[payer.id] ?? inbound} onChange={e => update("eraPayerIdentifiers", { ...form.eraPayerIdentifiers, [payer.id]: e.target.value })} /><div className="thera-table-subtext">{inbound ? "Existing ERA mapping" : "Kept separate from outbound ID"}</div></td>
                    <td><span className="thera-table-subtext">{outbound && filing ? "Available for Office Ally validation" : "Central catalog review needed"}</span></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <p className="thera-muted" style={{ marginTop: 10 }}>These mappings are centrally maintained. A catalog value alone is not proof of payer enrollment or acceptance.</p>
        </section>)}
      </WorkDrawer>
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
