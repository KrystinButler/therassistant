import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { StatusBadge } from "../components/status-badge";
import { buildPayer360View } from "../domains/credentialing/payer-360";
import { tenantInsert, tenantSelect, tenantUpdate, referenceSelect } from "../lib/tenant-data-client";
import { money, shortDate } from "../lib/format";

type Row = Record<string, any>;
type View = ReturnType<typeof buildPayer360View>;

type ModalKind = "resource" | "contract" | "schedule" | "rate" | null;

export function PayerDetailPage() {
  const [, params] = useRoute<{ id: string }>("/payers/:id");
  const payerId = params?.id ?? "";
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [resources, setResources] = useState<Row[]>([]);
  const [modal, setModal] = useState<ModalKind>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!payerId) return;
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      referenceSelect("payers"),
      referenceSelect("payer_plans"),
      tenantSelect("providers"),
      tenantSelect("provider_payer_enrollments"),
      tenantSelect("payer_contracts"),
      tenantSelect("fee_schedules"),
      tenantSelect("fee_schedule_lines"),
      tenantSelect("payer_resources", { payer_id: `eq.${payerId}`, order: "resource_type.asc,sort_order.asc,created_at.asc" }),
    ])
      .then(([payers, plans, providers, enrollments, contracts, feeSchedules, feeScheduleLines, resourceRows]) => {
        if (!active) return;
        setView(buildPayer360View({ payerId, payers, plans, providers, enrollments, contracts, feeSchedules, feeScheduleLines }));
        setResources(resourceRows);
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
      if (modal === "resource") {
        if (!form.label?.trim()) return;
        if (!form.value?.trim() && !form.url?.trim() && !form.notes?.trim()) {
          throw new Error("Add a value, URL, or operational note.");
        }
        const payload = {
          payer_id: payerId,
          resource_type: form.resource_type || "other",
          label: form.label.trim(),
          value: form.value?.trim() || null,
          url: form.url?.trim() || null,
          notes: form.notes?.trim() || null,
          effective_date: form.effective_date || null,
          expiration_date: form.expiration_date || null,
          payer_plan_id: form.payer_plan_id || null,
          source_url: form.source_url?.trim() || null,
          reviewed_at: form.reviewed_at || null,
          review_due_at: form.review_due_at || null,
          verification_status: form.verification_status || "unverified",
          updated_at: new Date().toISOString(),
        };
        if (form.id) await tenantUpdate("payer_resources", form.id, payload);
        else await tenantInsert("payer_resources", payload);
      } else if (modal === "contract") {
        if (!form.contract_name?.trim()) return;
        await tenantInsert("payer_contracts", {
          payer_id: payerId,
          contract_name: form.contract_name.trim(),
          status: form.status || "draft",
          effective_date: form.effective_date || null,
          notes: form.notes || null,
        });
      } else if (modal === "schedule") {
        if (!form.contract_id || !form.name?.trim()) return;
        await tenantInsert("fee_schedules", {
          payer_contract_id: form.contract_id,
          name: form.name.trim(),
          status: form.status || "draft",
          effective_date: form.effective_date || null,
        });
      } else if (modal === "rate") {
        if (!form.schedule_id || !form.cpt_code?.trim()) return;
        const rateCents = Math.round(Number(form.rate || 0) * 100);
        if (!Number.isFinite(rateCents) || rateCents < 0) {
          throw new Error("Enter a valid non-negative rate.");
        }
        await tenantInsert("fee_schedule_lines", {
          fee_schedule_id: form.schedule_id,
          cpt_code: form.cpt_code.trim(),
          modifier: form.modifier || null,
          rate_cents: rateCents,
          unit_type: form.unit_type || "service",
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
      await tenantUpdate("payer_contracts", String(contract.id), {
        status,
        termination_date: status === "terminated"
          ? new Date().toISOString().slice(0, 10)
          : null,
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
          <div className="thera-eyebrow">OPERATE · COLORADO PAYER PROFILE</div>
          <h1>{view.payer.name}</h1>
          <p>{view.payer.payer_type || "Payer"} · Shared payer knowledge for eligibility, participation, claims, payment, credentialing, and reimbursement.</p>
        </div>
        <div className="thera-filter-row">
          <button type="button" className="thera-action secondary" onClick={() => open("resource", { resource_type: "provider_services", label: "", value: "", url: "", source_url: "", notes: "", effective_date: "", expiration_date: "", payer_plan_id: "", reviewed_at: new Date().toISOString().slice(0, 10), review_due_at: "", verification_status: "unverified" })}>+ Payer Resource</button>
          <button type="button" className="thera-action secondary" onClick={() => open("contract", { contract_name: "", status: "draft", effective_date: "", notes: "" })}>+ Contract</button>
          <button type="button" className="thera-action secondary" onClick={() => open("schedule", { contract_id: view.contracts[0]?.id || "", name: "", status: "draft", effective_date: "" })}>+ Fee Schedule</button>
          <button type="button" className="thera-action" onClick={() => open("rate", { schedule_id: schedules[0]?.id || "", cpt_code: "", modifier: "", rate: "", unit_type: "service" })}>+ Rate</button>
        </div>
      </div>

      {error && <div className="thera-state error">{error}</div>}

      <div className="thera-metric-grid">
        <div className="thera-metric-card"><div className="thera-metric-label">Resources</div><div className="thera-metric-value">{resources.length}</div></div>
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
          <div className="thera-card-header"><div><h2>Plans & Products</h2><p>Reference products associated with this payer and reused across coverage and credentialing workflows.</p></div></div>
          <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Plan</th><th>Type</th></tr></thead><tbody>{view.plans.length === 0 && <tr><td colSpan={2}>No plans on file.</td></tr>}{view.plans.map((plan) => <tr key={plan.id}><td>{plan.name}</td><td>{plan.plan_type || "—"}</td></tr>)}</tbody></table></div>
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header"><div><h2>Provider Participation</h2><p>Providers enrolled or in process with {view.payer.name}.</p></div><Link href="/credentialing" className="thera-action secondary">Open Credentialing</Link></div>
          <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Provider</th><th>Status</th><th>Effective</th><th>Revalidation</th><th>Payer Provider ID</th></tr></thead><tbody>{view.enrolledProviders.length === 0 && <tr><td colSpan={5}>No provider enrollment records.</td></tr>}{view.enrolledProviders.map((row) => <tr key={row.id}><td><Link className="thera-table-link" href={`/providers/${row.provider_id}`}>{row.providerName}</Link></td><td><StatusBadge value={row.enrollment_status} /></td><td>{shortDate(row.effective_date)}</td><td>{shortDate(row.revalidation_due_date)}</td><td>{row.payer_provider_id || "—"}</td></tr>)}</tbody></table></div>
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header">
            <div>
              <div className="thera-eyebrow">SHARED PAYER KNOWLEDGE</div>
              <h2>Operational Resources</h2>
              <p>Contacts, portals, addresses, filing rules, credentialing links, directories, and payer-specific guidance reused across THERASSISTANT.</p>
            </div>
            <button type="button" className="thera-action secondary" onClick={() => open("resource", { resource_type: "provider_services", label: "", value: "", url: "", source_url: "", notes: "", effective_date: "", expiration_date: "", payer_plan_id: "", reviewed_at: new Date().toISOString().slice(0, 10), review_due_at: "", verification_status: "unverified" })}>+ Resource</button>
          </div>
          {resources.length === 0 ? (
            <div className="thera-empty">No payer resources have been captured yet.</div>
          ) : (
            <div className="thera-table-wrap">
              <table className="thera-table">
                <thead><tr><th>Area</th><th>Plan</th><th>Resource</th><th>Value / Link</th><th>Operational Notes</th><th>Verification</th><th>Reviewed</th><th>Next Review</th><th>Effective</th><th>Expires</th><th>Source</th><th /></tr></thead>
                <tbody>
                  {resources.map((resource) => (
                    <tr key={resource.id}>
                      <td><StatusBadge value={resourceLabel(String(resource.resource_type ?? "other"))} /></td>
                      <td>{view.plans.find((plan) => plan.id === resource.payer_plan_id)?.name || "All payer plans"}</td>
                      <td><strong>{String(resource.label ?? "Resource")}</strong></td>
                      <td>
                        {resource.url ? <a className="thera-link" href={String(resource.url)} target="_blank" rel="noreferrer">{resource.value || "Open resource"}</a> : String(resource.value ?? "—")}
                      </td>
                      <td>{String(resource.notes ?? "—")}</td>
                      <td><StatusBadge value={String(resource.verification_status ?? "unverified")} /></td>
                      <td>{shortDate(resource.reviewed_at)}</td>
                      <td>{shortDate(resource.review_due_at)}</td>
                      <td>{shortDate(resource.effective_date)}</td>
                      <td>{shortDate(resource.expiration_date)}</td>
                      <td>{resource.source_url ? <a className="thera-link" href={String(resource.source_url)} target="_blank" rel="noreferrer">Source</a> : "—"}</td>
                      <td><button type="button" className="thera-action secondary" onClick={() => open("resource", {
                        id: String(resource.id),
                        resource_type: String(resource.resource_type ?? "other"),
                        label: String(resource.label ?? ""),
                        value: String(resource.value ?? ""),
                        url: String(resource.url ?? ""),
                        source_url: String(resource.source_url ?? ""),
                        notes: String(resource.notes ?? ""),
                        payer_plan_id: String(resource.payer_plan_id ?? ""),
                        effective_date: String(resource.effective_date ?? "").slice(0, 10),
                        expiration_date: String(resource.expiration_date ?? "").slice(0, 10),
                        reviewed_at: String(resource.reviewed_at ?? "").slice(0, 10),
                        review_due_at: String(resource.review_due_at ?? "").slice(0, 10),
                        verification_status: String(resource.verification_status ?? "unverified"),
                      })}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
        {modal === "resource" && <Grid>
          <Select label="Area" value={form.resource_type || "other"} options={[
            { value: "provider_services", label: "Provider Services / Contact" },
            { value: "eligibility", label: "Eligibility & Benefits" },
            { value: "claims", label: "Claims / EDI" },
            { value: "credentialing", label: "Credentialing" },
            { value: "appeals", label: "Appeals / Disputes" },
            { value: "directory", label: "Provider Directory" },
            { value: "portal", label: "Portal" },
            { value: "mailing_address", label: "Mailing Address" },
            { value: "timely_filing", label: "Timely Filing" },
            { value: "corrected_claim", label: "Corrected Claim Rule" },
            { value: "reimbursement", label: "Reimbursement Guidance" },
            { value: "other", label: "Other" },
          ]} onChange={(value) => setForm({ ...form, resource_type: value })} />
          <Select label="Plan / Product (blank = payer-wide)" value={form.payer_plan_id || ""} options={view.plans.map((plan) => ({ value: plan.id, label: plan.name }))} onChange={(value) => setForm({ ...form, payer_plan_id: value })} />
          <Input label="Resource Name" value={form.label || ""} onChange={(value) => setForm({ ...form, label: value })} />
          <Input label="Value / Phone / Address" value={form.value || ""} onChange={(value) => setForm({ ...form, value })} />
          <Input label="Working URL" value={form.url || ""} onChange={(value) => setForm({ ...form, url: value })} />
          <Input label="Authoritative Source URL" value={form.source_url || ""} onChange={(value) => setForm({ ...form, source_url: value })} />
          <Select label="Verification" value={form.verification_status || "unverified"} options={[
            { value: "verified", label: "Verified" },
            { value: "needs_review", label: "Needs review" },
            { value: "unverified", label: "Unverified" },
          ]} onChange={(value) => setForm({ ...form, verification_status: value })} />
          <Input label="Last Source Review" type="date" value={form.reviewed_at || ""} onChange={(value) => setForm({ ...form, reviewed_at: value })} />
          <Input label="Next Review Due" type="date" value={form.review_due_at || ""} onChange={(value) => setForm({ ...form, review_due_at: value })} />
          <Input label="Effective Date" type="date" value={form.effective_date || ""} onChange={(value) => setForm({ ...form, effective_date: value })} />
          <Input label="Expiration Date" type="date" value={form.expiration_date || ""} onChange={(value) => setForm({ ...form, expiration_date: value })} />
          <label style={{ gridColumn: "1 / -1" }}><div className="thera-field-label">Operational Notes</div><textarea className="thera-input" rows={4} value={form.notes || ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        </Grid>}
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

function resourceLabel(value: string) {
  const labels: Record<string, string> = {
    provider_services: "Provider Services",
    eligibility: "Eligibility",
    claims: "Claims / EDI",
    credentialing: "Credentialing",
    appeals: "Appeals",
    directory: "Directory",
    portal: "Portal",
    mailing_address: "Mailing Address",
    timely_filing: "Timely Filing",
    corrected_claim: "Corrected Claim",
    reimbursement: "Reimbursement",
    other: "Other",
  };
  return labels[value] || value.replaceAll("_", " ");
}

function modalTitle(kind: Exclude<ModalKind, null>) {
  if (kind === "resource") return "Payer Intelligence Resource";
  if (kind === "contract") return "Add Contract";
  if (kind === "schedule") return "Add Fee Schedule";
  return "Add Fee Schedule Rate";
}
