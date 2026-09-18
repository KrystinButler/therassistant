import { useEffect, useMemo, useState } from "react";

import { WorkDrawer } from "../../components/work-drawer";
import {
  getCurrentTenantId,
  referenceSelect,
  tenantRpc,
  tenantSelect,
} from "../../lib/tenant-data-client";

type Row = Record<string, any>;

type FormState = {
  provider_id: string;
  payer_id: string;
  payer_plan_id: string;
  practice_entity_id: string;
  practice_location_id: string;
  payer_contract_id: string;
  application_type: string;
  priority: string;
  notes: string;
};

const blankForm: FormState = {
  provider_id: "",
  payer_id: "",
  payer_plan_id: "",
  practice_entity_id: "",
  practice_location_id: "",
  payer_contract_id: "",
  application_type: "initial",
  priority: "normal",
  notes: "",
};

export function NewCredentialingCaseDrawer({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<FormState>(blankForm);
  const [providers, setProviders] = useState<Row[]>([]);
  const [payers, setPayers] = useState<Row[]>([]);
  const [plans, setPlans] = useState<Row[]>([]);
  const [entities, setEntities] = useState<Row[]>([]);
  const [locations, setLocations] = useState<Row[]>([]);
  const [contracts, setContracts] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      tenantSelect("providers", { provider_status: "neq.terminated" }),
      referenceSelect("payers"),
      referenceSelect("payer_plans"),
      tenantSelect("practice_entities", { status: "eq.active" }),
      tenantSelect("practice_locations", { status: "eq.active" }),
      tenantSelect("payer_contracts"),
    ])
      .then(([providerRows, payerRows, planRows, entityRows, locationRows, contractRows]) => {
        if (!active) return;
        setProviders(providerRows.toSorted((a, b) =>
          String(a.last_name || "").localeCompare(String(b.last_name || "")),
        ));
        setPayers(payerRows.toSorted((a, b) =>
          String(a.name || "").localeCompare(String(b.name || "")),
        ));
        setPlans(planRows);
        setEntities(entityRows);
        setLocations(locationRows);
        setContracts(contractRows);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to load credentialing setup data");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open]);

  const payerPlans = useMemo(
    () => plans.filter((row) => row.payer_id === form.payer_id),
    [plans, form.payer_id],
  );
  const scopedLocations = useMemo(
    () =>
      locations.filter(
        (row) =>
          !form.practice_entity_id ||
          !row.practice_entity_id ||
          row.practice_entity_id === form.practice_entity_id,
      ),
    [locations, form.practice_entity_id],
  );
  const scopedContracts = useMemo(
    () =>
      contracts.filter(
        (row) =>
          row.payer_id === form.payer_id &&
          (!form.practice_entity_id ||
            !row.practice_entity_id ||
            row.practice_entity_id === form.practice_entity_id),
      ),
    [contracts, form.payer_id, form.practice_entity_id],
  );

  function close() {
    setForm(blankForm);
    setError(null);
    onOpenChange(false);
  }

  async function createCase() {
    if (!form.provider_id || !form.payer_id) return;
    setSaving(true);
    setError(null);
    try {
      const tenantId = await getCurrentTenantId();
      await tenantRpc<Row[]>("create_credentialing_case", {
        p_tenant_id: tenantId,
        p_provider_id: form.provider_id,
        p_payer_id: form.payer_id,
        p_payer_plan_id: form.payer_plan_id || null,
        p_practice_entity_id: form.practice_entity_id || null,
        p_practice_location_id: form.practice_location_id || null,
        p_payer_contract_id: form.payer_contract_id || null,
        p_application_type: form.application_type,
        p_priority: form.priority,
        p_notes: form.notes.trim() || null,
      });
      close();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create credentialing case");
    } finally {
      setSaving(false);
    }
  }

  return (
    <WorkDrawer
      open={open}
      onOpenChange={onOpenChange}
      dirty={Boolean(
        form.provider_id ||
          form.payer_id ||
          form.payer_plan_id ||
          form.practice_entity_id ||
          form.practice_location_id ||
          form.payer_contract_id ||
          form.notes,
      )}
      title="New Credentialing Case"
      subtitle="Create the provider × payer × product × entity × location scope"
      footer={
        <div className="thera-filter-row" style={{ justifyContent: "space-between" }}>
          <button type="button" className="thera-action secondary" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="thera-action"
            disabled={saving || loading || !form.provider_id || !form.payer_id}
            onClick={() => void createCase()}
          >
            {saving ? "Creating..." : "Create Credentialing Case"}
          </button>
        </div>
      }
    >
      {error ? <div className="thera-state error">{error}</div> : null}
      {loading ? <div className="thera-state">Loading setup data...</div> : null}

      {!loading ? (
        <div className="thera-form-grid">
          <label>
            Provider *
            <select
              className="thera-input"
              value={form.provider_id}
              onChange={(event) => setForm({ ...form, provider_id: event.target.value })}
            >
              <option value="">Select provider</option>
              {providers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.last_name}, {row.first_name}{row.credentials ? `, ${row.credentials}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            Payer *
            <select
              className="thera-input"
              value={form.payer_id}
              onChange={(event) =>
                setForm({
                  ...form,
                  payer_id: event.target.value,
                  payer_plan_id: "",
                  payer_contract_id: "",
                })
              }
            >
              <option value="">Select payer</option>
              {payers.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>

          <label>
            Product / Plan
            <select
              className="thera-input"
              value={form.payer_plan_id}
              disabled={!form.payer_id}
              onChange={(event) => setForm({ ...form, payer_plan_id: event.target.value })}
            >
              <option value="">All products</option>
              {payerPlans.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}{row.plan_type ? ` · ${row.plan_type}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            Legal Entity / TIN
            <select
              className="thera-input"
              value={form.practice_entity_id}
              onChange={(event) =>
                setForm({
                  ...form,
                  practice_entity_id: event.target.value,
                  practice_location_id: "",
                  payer_contract_id: "",
                })
              }
            >
              <option value="">No entity selected</option>
              {entities.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.legal_name}{row.dba_name ? ` · ${row.dba_name}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            Location
            <select
              className="thera-input"
              value={form.practice_location_id}
              onChange={(event) =>
                setForm({ ...form, practice_location_id: event.target.value })
              }
            >
              <option value="">No location selected</option>
              {scopedLocations.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>

          <label>
            Payer Contract
            <select
              className="thera-input"
              value={form.payer_contract_id}
              disabled={!form.payer_id}
              onChange={(event) =>
                setForm({ ...form, payer_contract_id: event.target.value })
              }
            >
              <option value="">No contract selected</option>
              {scopedContracts.map((row) => (
                <option key={row.id} value={row.id}>{row.contract_name}</option>
              ))}
            </select>
          </label>

          <label>
            Application Type
            <select
              className="thera-input"
              value={form.application_type}
              onChange={(event) =>
                setForm({ ...form, application_type: event.target.value })
              }
            >
              <option value="initial">Initial</option>
              <option value="recredentialing">Recredentialing</option>
              <option value="add_location">Add Location</option>
              <option value="add_product">Add Product</option>
              <option value="other">Other</option>
            </select>
          </label>

          <label>
            Priority
            <select
              className="thera-input"
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value })}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>

          <label style={{ gridColumn: "1 / -1" }}>
            Notes
            <textarea
              className="thera-input"
              rows={4}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </label>
        </div>
      ) : null}
    </WorkDrawer>
  );
}
