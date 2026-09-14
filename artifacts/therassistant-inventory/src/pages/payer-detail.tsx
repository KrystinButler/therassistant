import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { StatusBadge } from "../components/status-badge";
import { buildPayer360View } from "../domains/credentialing/payer-360";
import { demoRows, referenceRows } from "../lib/demo-data";
import { money, shortDate } from "../lib/format";

type Row = Record<string, any>;
type View = ReturnType<typeof buildPayer360View>;

type ModalKind = "plan" | "contract" | "schedule" | "rate" | null;

async function apiJson(path: string, init: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export function PayerDetailPage() {
  const [, params] = useRoute<{ id: string }>("/payers/:id");
  const payerId = params?.id ?? "";
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!payerId) return;
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      referenceRows("payers"),
      referenceRows("payer_plans"),
      demoRows("providers"),
      demoRows("provider_payer_enrollments"),
      demoRows("payer_contracts"),
      demoRows("fee_schedules"),
      demoRows("fee_schedule_lines"),
    ])
      .then(([payers, plans, providers, enrollments, contracts, feeSchedules, feeScheduleLines]) => {
        if (!active) return;
        setView(buildPayer360View({ payerId, payers, plans, providers, enrollments, contracts, feeSchedules, feeScheduleLines }));
      })
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : "Unable to load payer"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [payerId, version]);

  function open(kind: ModalKind, initial: Record<string, string> = {}) {
    setForm(initial);
    setModal(kind);
  }

  async function save() {
    if (!view || !modal) return;
    setError(null);
    try {
      if (modal === "plan") {
        await apiJson(`/api/payers/${payerId}/plans`, {
          method: "POST",
          body: JSON.stringify({ name: form.name, plan_type: form.plan_type || null }),
        });
      } else if (modal === "contract") {
        await apiJson(`/api/payers/${payerId}/contracts`, {
          method: "POST",
          body: JSON.stringify({ contract_name: form.contract_name, status: form.status || "draft", effective_date: form.effective_date || null, notes: form.notes || null }),
        });
      } else if (modal === "schedule") {
        if (!form.contract_id) return;
        await apiJson(`/api/payers/${payerId}/contracts/${form.contract_id}/fee-schedules`, {
          method: "POST",
          body: JSON.stringify({ name: form.name, status: form.status || "draft", effective_date: form.effective_date || null }),
        });
      } else if (modal === "rate") {
        if (!form.schedule_id) return;
        await apiJson(`/api/payers/${payerId}/fee-schedules/${form.schedule_id}/lines`, {
          method: "POST",
          body: JSON.stringify({
            cpt_code: form.cpt_code,
            modifier: form.modifier || null,
            rate_cents: Math.round(Number(form.rate || 0) * 100),
            unit_type: form.unit_type || null,
          }),
        });
      }
      setModal(null);
      setForm({});
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save payer data");
    }
  }

  async function updateContract(contract: Row, status: string) {
    setError(null);
    try {
      await apiJson(`/api/payers/${payerId}/contracts/${contract.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          termination_date: status === "terminated" ? new Date().toISOString().slice(0, 10) : null,
        }),
      });
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update contract");
    }
  }

  if (loading) return <div className="thera-state">Loading payer...</div>;
  if (error && !view) return <div className="thera-state error">{error}</div>;
  if (!view) return <div className="thera-state error">Payer not found.</div>;

  const schedules = view.contracts.flatMap((contract) => contract.feeSchedules);

  return (
    <>
      <div className="thera-breadcrumb"><Link href="/payers-contracts" className="thera-link">Payers & Contracts</Link><span>/</span><span>{view.payer.name}</span></div>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">PAYER 360</div>
          <h1>{view.payer.name}</h1>
          <p>{view.payer.payer_type || "Payer"} · Clearinghouse ID {view.payer.clearinghouse_payer_id || "not configured"}</p>
        </div>
        <div className="thera-filter-row">
          <button type="button" className="thera-action secondary" onClick={() => open("plan", { name: "", plan_type: "" })}>+ Plan</button>
          <button type="button" className="thera-action secondary" onClick={() => open("contract", { contract_name: "", status: "draft", effective_date: "", notes: "" })}>+ Contract</button>
          <button type="button" className="thera-action secondary" onClick={() => open("schedule", { contract_id: view.contracts[0]?.id || "", name: "", status: "draft", effective_date: "" })}>+ Fee Schedule</button>
          <button type="button" className="thera-action" onClick={() => open("rate", { schedule_id: schedules[0]?.id || "", cpt_code: "", modifier: "", rate: "", unit_type: "service" })}>+ Rate</button>
        </div>
      </div>

      {error && <div className="thera-state error">{error}</div>}

      <div className="thera-metric-grid">
        <div className="thera-metric-card"><div className="thera-metric-label">Plans</div><div className="thera-metric-value">{view.plans.length}</div></div>
        <div className="thera-metric-card"><div className="thera-metric-label">Enrolled Providers</div><div className="thera-metric-value">{view.enrolledProviders.length}</div></div>
        <div className="thera-metric-card"><div className="thera-metric-label">Contracts</div><div className="thera-metric-value">{view.contracts.length}</div></div>
        <div className="thera-metric-card"><div className="thera-metric-label">Fee Schedules</div><div className="thera-metric-value">{schedules.length}</div></div>
      </div>

      <div className="thera-detail-grid">
        <section className="thera-card">
          <h2>Payer Information</h2>
          <div className="thera-definition-grid">
            <Field name="Payer Type" value={view.payer.payer_type || "—"} />
            <Field name="Clearinghouse ID" value={view.payer.clearinghouse_payer_id || "—"} />
            <Field name="Plans" value={view.plans.length} />
            <Field name="Participating Providers" value={view.enrolledProviders.filter((row) => row.enrollment_status === "approved").length} />
          </div>
        </section>

        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Plans & Products</h2><p>Products associated with this payer.</p></div><button type="button" className="thera-action secondary" onClick={() => open("plan", { name: "", plan_type: "" })}>+ Plan</button></div>
          <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Plan</th><th>Type</th></tr></thead><tbody>{view.plans.length === 0 && <tr><td colSpan={2}>No plans on file.</td></tr>}{view.plans.map((plan) => <tr key={plan.id}><td>{plan.name}</td><td>{plan.plan_type || "—"}</td></tr>)}</tbody></table></div>
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header"><div><h2>Provider Participation</h2><p>Providers enrolled or in process with {view.payer.name}.</p></div><Link href="/credentialing" className="thera-action secondary">Open Credentialing</Link></div>
          <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Provider</th><th>Status</th><th>Effective</th><th>Revalidation</th><th>Payer Provider ID</th></tr></thead><tbody>{view.enrolledProviders.length === 0 && <tr><td colSpan={5}>No provider enrollment records.</td></tr>}{view.enrolledProviders.map((row) => <tr key={row.id}><td><Link className="thera-table-link" href={`/providers/${row.provider_id}`}>{row.providerName}</Link></td><td><StatusBadge value={row.enrollment_status} /></td><td>{shortDate(row.effective_date)}</td><td>{shortDate(row.revalidation_due_date)}</td><td>{row.payer_provider_id || "—"}</td></tr>)}</tbody></table></div>
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header"><div><h2>Contracts & Fee Schedules</h2><p>Contract lifecycle and expected allowed amounts.</p></div><button type="button" className="thera-action secondary" onClick={() => open("contract", { contract_name: "", status: "draft", effective_date: "", notes: "" })}>+ Contract</button></div>
          {view.contracts.length === 0 && <div className="thera-state">No contracts on file.</div>}
          <div className="thera-stack">
            {view.contracts.map((contract) => <div className="thera-story" key={contract.id}>
              <div className="thera-row-between">
                <div><strong>{contract.contract_name}</strong><div className="thera-table-subtext">Effective {shortDate(contract.effective_date)} · Terminates {shortDate(contract.termination_date)}</div></div>
                <div className="thera-filter-row"><StatusBadge value={contract.status} />{contract.status !== "active" && <button type="button" className="thera-action secondary" onClick={() => void updateContract(contract, "active")}>Activate</button>}{contract.status !== "terminated" && <button type="button" className="thera-action secondary" onClick={() => void updateContract(contract, "terminated")}>Terminate</button>}</div>
              </div>
              {contract.notes && <p>{contract.notes}</p>}
              {contract.feeSchedules.map((schedule: Row) => <div key={schedule.id} style={{ marginTop: 16 }}>
                <div className="thera-row-between"><strong>{schedule.name}</strong><StatusBadge value={schedule.status} /></div>
                <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>CPT</th><th>Modifier</th><th>Rate</th><th>Unit</th></tr></thead><tbody>{schedule.lines.length === 0 && <tr><td colSpan={4}>No rates on this schedule.</td></tr>}{schedule.lines.map((line: Row) => <tr key={line.id}><td>{line.cpt_code}</td><td>{line.modifier || "—"}</td><td>{money(line.rate_cents)}</td><td>{line.unit_type || "—"}</td></tr>)}</tbody></table></div>
              </div>)}
            </div>)}
          </div>
        </section>
      </div>

      {modal && <Modal title={modalTitle(modal)} onClose={() => setModal(null)}>
        {modal === "plan" && <Grid><Input label="Plan Name" value={form.name || ""} onChange={(value) => setForm({ ...form, name: value })} /><Input label="Plan Type" value={form.plan_type || ""} onChange={(value) => setForm({ ...form, plan_type: value })} /></Grid>}
        {modal === "contract" && <Grid><Input label="Contract Name" value={form.contract_name || ""} onChange={(value) => setForm({ ...form, contract_name: value })} /><Select label="Status" value={form.status || "draft"} options={["draft", "pending", "active"]} onChange={(value) => setForm({ ...form, status: value })} /><Input label="Effective Date" type="date" value={form.effective_date || ""} onChange={(value) => setForm({ ...form, effective_date: value })} /><Input label="Notes" value={form.notes || ""} onChange={(value) => setForm({ ...form, notes: value })} /></Grid>}
        {modal === "schedule" && <Grid><Select label="Contract" value={form.contract_id || ""} options={view.contracts.map((contract) => ({ value: contract.id, label: contract.contract_name }))} onChange={(value) => setForm({ ...form, contract_id: value })} /><Input label="Schedule Name" value={form.name || ""} onChange={(value) => setForm({ ...form, name: value })} /><Select label="Status" value={form.status || "draft"} options={["draft", "pending", "active"]} onChange={(value) => setForm({ ...form, status: value })} /><Input label="Effective Date" type="date" value={form.effective_date || ""} onChange={(value) => setForm({ ...form, effective_date: value })} /></Grid>}
        {modal === "rate" && <Grid><Select label="Fee Schedule" value={form.schedule_id || ""} options={schedules.map((schedule) => ({ value: schedule.id, label: schedule.name }))} onChange={(value) => setForm({ ...form, schedule_id: value })} /><Input label="CPT Code" value={form.cpt_code || ""} onChange={(value) => setForm({ ...form, cpt_code: value })} /><Input label="Modifier" value={form.modifier || ""} onChange={(value) => setForm({ ...form, modifier: value })} /><Input label="Rate ($)" type="number" value={form.rate || ""} onChange={(value) => setForm({ ...form, rate: value })} /><Input label="Unit Type" value={form.unit_type || ""} onChange={(value) => setForm({ ...form, unit_type: value })} /></Grid>}
        <div style={{ marginTop: 16 }}><button type="button" className="thera-action" onClick={() => void save()}>Save</button></div>
      </Modal>}
    </>
  );
}

function Field({ name, value }: { name: string; value: React.ReactNode }) {
  return <div><div className="thera-field-label">{name}</div><div className="thera-field-value">{value}</div></div>;
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>{children}</div>;
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label><div className="thera-field-label">{label}</div><input className="thera-input" type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: Array<string | { value: string; label: string }>; onChange: (value: string) => void }) {
  return <label><div className="thera-field-label">{label}</div><select className="thera-input" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Select</option>{options.map((option) => typeof option === "string" ? <option key={option} value={option}>{option.replaceAll("_", " ")}</option> : <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 1000, padding: 20 }}><section className="thera-card" style={{ width: "min(760px,100%)", maxHeight: "90vh", overflow: "auto" }}><div className="thera-card-header"><h2>{title}</h2><button type="button" className="thera-action secondary" onClick={onClose}>Close</button></div>{children}</section></div>;
}

function modalTitle(kind: Exclude<ModalKind, null>) {
  if (kind === "plan") return "Add Payer Plan";
  if (kind === "contract") return "Add Contract";
  if (kind === "schedule") return "Add Fee Schedule";
  return "Add Fee Schedule Rate";
}
