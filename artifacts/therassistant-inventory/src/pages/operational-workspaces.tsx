import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { StatusBadge } from "../components/status-badge";
import { dateTime, money, shortDate } from "../lib/format";
import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  referenceSelect,
} from "../lib/tenant-data-client";

type Row = Record<string, any>;

type LoadState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []): LoadState<T> {
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loader()
      .then((value) => active && setData(value))
      .catch((err: unknown) =>
        active && setError(err instanceof Error ? err.message : "Unable to load data"),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  return { data, loading, error, reload: () => setVersion((v) => v + 1) };
}

function name(row?: Row | null) {
  return row ? [row.first_name, row.last_name].filter(Boolean).join(" ") : "—";
}

function byId(rows: Row[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function WorkspaceHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="thera-page-header split">
      <div>
        <div className="thera-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function State({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <div className="thera-state">Loading...</div>;
  if (error) return <div className="thera-state error">{error}</div>;
  return null;
}

function ActionButton({ children, onClick, secondary = false }: { children: ReactNode; onClick: () => void | Promise<void>; secondary?: boolean }) {
  return (
    <button type="button" className={secondary ? "thera-action secondary" : "thera-action"} onClick={() => void onClick()}>
      {children}
    </button>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 1000, padding: 20 }}>
      <div className="thera-card" style={{ width: "min(680px, 100%)", maxHeight: "90vh", overflow: "auto" }}>
        <div className="thera-card-header">
          <h2>{title}</h2>
          <button type="button" className="thera-action secondary" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FieldGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label><div className="thera-field-label">{label}</div>{children}</label>;
}

const inputClass = "thera-input";

export function SchedulePage() {
  const state = useLoad(async () => {
    const [appointments, clients, providers] = await Promise.all([
      tenantSelect("appointments"), tenantSelect("clients"), tenantSelect("providers"),
    ]);
    const clientsById = byId(clients);
    const providersById = byId(providers);
    return { appointments, clients, providers, clientsById, providersById };
  });
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ client_id: "", provider_id: "", date: "", time: "09:00", service_type: "Individual Therapy", cpt_code: "90837", location_type: "telehealth" });

  async function save() {
    if (!form.client_id || !form.date || !form.time) return;
    const start = new Date(`${form.date}T${form.time}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    await tenantInsert("appointments", {
      client_id: form.client_id,
      provider_id: form.provider_id || null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      appointment_status: "scheduled",
      location_type: form.location_type,
      service_type: form.service_type,
      cpt_code: form.cpt_code,
    });
    setShowNew(false);
    state.reload();
  }

  return (
    <>
      <WorkspaceHeader eyebrow="CLINICAL OPERATIONS" title="Schedule" description="Appointments by patient and provider, with status actions and scheduling controls." action={<ActionButton onClick={() => setShowNew(true)}>+ New Appointment</ActionButton>} />
      <section className="thera-card">
        <State loading={state.loading} error={state.error} />
        {state.data && <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date / Time</th><th>Patient</th><th>Provider</th><th>Service</th><th>Location</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {state.data.appointments.sort((a,b) => String(a.starts_at).localeCompare(String(b.starts_at))).map((appt) => <tr key={appt.id}>
            <td>{dateTime(appt.starts_at)}</td>
            <td><Link className="thera-table-link" href={`/clients/${appt.client_id}`}>{name(state.data!.clientsById.get(appt.client_id))}</Link></td>
            <td>{name(state.data!.providersById.get(appt.provider_id))}</td>
            <td>{appt.service_type || "—"}<div className="thera-table-subtext">{appt.cpt_code || ""}</div></td>
            <td>{String(appt.location_type || "—").replaceAll("_", " ")}</td>
            <td><StatusBadge value={appt.appointment_status} /></td>
            <td><div className="thera-filter-row">
              {appt.appointment_status === "scheduled" && <ActionButton secondary onClick={async () => { await tenantUpdate("appointments", appt.id, { appointment_status: "confirmed" }); state.reload(); }}>Confirm</ActionButton>}
              {!['completed','cancelled','no_show'].includes(appt.appointment_status) && <ActionButton secondary onClick={async () => { await tenantUpdate("appointments", appt.id, { appointment_status: "completed", completed_at: new Date().toISOString() }); state.reload(); }}>Complete</ActionButton>}
              {!['completed','cancelled','no_show'].includes(appt.appointment_status) && <ActionButton secondary onClick={async () => { await tenantUpdate("appointments", appt.id, { appointment_status: "no_show" }); state.reload(); }}>No Show</ActionButton>}
            </div></td>
          </tr>)}
        </tbody></table></div>}
      </section>
      {showNew && state.data && <Modal title="New Appointment" onClose={() => setShowNew(false)}><FieldGrid>
        <Field label="Patient"><select className={inputClass} value={form.client_id} onChange={(e) => setForm({...form, client_id:e.target.value})}><option value="">Select patient</option>{state.data.clients.map((c) => <option key={c.id} value={c.id}>{name(c)}</option>)}</select></Field>
        <Field label="Provider"><select className={inputClass} value={form.provider_id} onChange={(e) => setForm({...form, provider_id:e.target.value})}><option value="">Unassigned</option>{state.data.providers.map((p) => <option key={p.id} value={p.id}>{name(p)} {p.credentials || ""}</option>)}</select></Field>
        <Field label="Date"><input className={inputClass} type="date" value={form.date} onChange={(e) => setForm({...form,date:e.target.value})} /></Field>
        <Field label="Time"><input className={inputClass} type="time" value={form.time} onChange={(e) => setForm({...form,time:e.target.value})} /></Field>
        <Field label="Service"><input className={inputClass} value={form.service_type} onChange={(e) => setForm({...form,service_type:e.target.value})} /></Field>
        <Field label="CPT"><input className={inputClass} value={form.cpt_code} onChange={(e) => setForm({...form,cpt_code:e.target.value})} /></Field>
        <Field label="Location"><select className={inputClass} value={form.location_type} onChange={(e) => setForm({...form,location_type:e.target.value})}><option value="telehealth">Telehealth</option><option value="in_person">In Person</option><option value="phone">Phone</option></select></Field>
      </FieldGrid><div style={{marginTop:16}}><ActionButton onClick={save}>Save Appointment</ActionButton></div></Modal>}
    </>
  );
}

export function ChargesPage() {
  const state = useLoad(async () => {
    const [charges, clients, providers, payers] = await Promise.all([tenantSelect("charge_capture_items"), tenantSelect("clients"), tenantSelect("providers"), referenceSelect("payers")]);
    return { charges, clients: byId(clients), providers: byId(providers), payers: byId(payers) };
  });

  async function createClaim(charge: Row) {
    await tenantInsert("professional_claims", {
      charge_id: charge.id,
      client_id: charge.client_id,
      rendering_provider_id: charge.provider_id,
      billing_provider_id: charge.provider_id,
      payer_id: charge.payer_id,
      claim_status: "ready_for_validation",
      service_date_from: charge.service_date,
      service_date_to: charge.service_date,
      total_charge_cents: charge.charge_amount_cents,
      patient_control_number: `TA-${Date.now()}`,
    });
    await tenantUpdate("charge_capture_items", charge.id, { charge_status: "claim_created", block_reason: null });
    state.reload();
  }

  return <><WorkspaceHeader eyebrow="BILLING READINESS" title="Charge Capture" description="Actionable charge workqueue with patient, provider, payer and billing readiness." />
    <section className="thera-card"><State loading={state.loading} error={state.error} />{state.data && <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>DOS</th><th>Patient</th><th>Provider</th><th>Payer</th><th>Service</th><th>Charge</th><th>Status</th><th>Issue</th><th>Actions</th></tr></thead><tbody>{state.data.charges.map((row) => <tr key={row.id}><td>{shortDate(row.service_date)}</td><td>{name(state.data!.clients.get(row.client_id))}</td><td>{name(state.data!.providers.get(row.provider_id))}</td><td>{state.data!.payers.get(row.payer_id)?.name || "—"}</td><td>{row.cpt_code}<div className="thera-table-subtext">Dx {row.diagnosis_code || "—"}</div></td><td>{money(row.charge_amount_cents)}</td><td><StatusBadge value={row.charge_status} /></td><td>{row.block_reason || "—"}</td><td><div className="thera-filter-row">{row.charge_status === "captured" && <ActionButton secondary onClick={async()=>{await tenantUpdate("charge_capture_items",row.id,{charge_status:"ready_for_claim",block_reason:null});state.reload();}}>Ready for Claim</ActionButton>}{row.charge_status === "ready_for_claim" && <ActionButton onClick={() => createClaim(row)}>Create Claim</ActionButton>}{!['claim_created','voided'].includes(row.charge_status) && <ActionButton secondary onClick={async()=>{const reason=window.prompt("Block reason");if(reason){await tenantUpdate("charge_capture_items",row.id,{charge_status:"blocked",block_reason:reason});state.reload();}}}>Block</ActionButton>}</div></td></tr>)}</tbody></table></div>}</section></>;
}

export function PaymentsPage() {
  const state = useLoad(async () => {
    const [payments, clients, payers] = await Promise.all([tenantSelect("payments"), tenantSelect("clients"), referenceSelect("payers")]);
    return { payments, clients: byId(clients), payers: byId(payers), clientRows: clients, payerRows: payers };
  });
  const [showNew,setShowNew]=useState(false);
  const [form,setForm]=useState({client_id:"",payer_id:"",amount:"",payment_method:"eft",payment_source:"insurance",trace_number:""});
  async function save(){if(!form.amount)return;await tenantInsert("payments",{client_id:form.client_id||null,payer_id:form.payer_id||null,payment_source:form.payment_source,payment_method:form.payment_method,payment_status:"pending",amount_cents:Math.round(Number(form.amount)*100),payment_date:new Date().toISOString().slice(0,10),trace_number:form.trace_number||null});setShowNew(false);state.reload();}
  return <><WorkspaceHeader eyebrow="REMITTANCE OPERATIONS" title="Payments" description="Payment posting workqueue with patient and payer context instead of internal IDs." action={<ActionButton onClick={()=>setShowNew(true)}>+ Add Payment</ActionButton>} /><section className="thera-card"><State loading={state.loading} error={state.error}/>{state.data&&<div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Patient</th><th>Payer</th><th>Source / Method</th><th>Amount</th><th>Trace</th><th>Status</th><th>Actions</th></tr></thead><tbody>{state.data.payments.map((p)=><tr key={p.id}><td>{shortDate(p.payment_date)}</td><td>{name(state.data!.clients.get(p.client_id))}</td><td>{state.data!.payers.get(p.payer_id)?.name||"—"}</td><td>{p.payment_source}<div className="thera-table-subtext">{p.payment_method}</div></td><td>{money(p.amount_cents)}</td><td>{p.trace_number||"—"}</td><td><StatusBadge value={p.payment_status}/></td><td><div className="thera-filter-row">{p.payment_status!=="posted"&&<ActionButton onClick={async()=>{await tenantUpdate("payments",p.id,{payment_status:"posted",posted_at:new Date().toISOString()});state.reload();}}>Post</ActionButton>}<ActionButton secondary onClick={async()=>{await tenantUpdate("payments",p.id,{payment_status:"unapplied"});state.reload();}}>Mark Unapplied</ActionButton></div></td></tr>)}</tbody></table></div>}</section>{showNew&&state.data&&<Modal title="Add Payment" onClose={()=>setShowNew(false)}><FieldGrid><Field label="Patient"><select className={inputClass} value={form.client_id} onChange={(e)=>setForm({...form,client_id:e.target.value})}><option value="">Unassigned</option>{state.data.clientRows.map((c)=><option key={c.id} value={c.id}>{name(c)}</option>)}</select></Field><Field label="Payer"><select className={inputClass} value={form.payer_id} onChange={(e)=>setForm({...form,payer_id:e.target.value})}><option value="">Select payer</option>{state.data.payerRows.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Amount"><input className={inputClass} type="number" step="0.01" value={form.amount} onChange={(e)=>setForm({...form,amount:e.target.value})}/></Field><Field label="Method"><select className={inputClass} value={form.payment_method} onChange={(e)=>setForm({...form,payment_method:e.target.value})}><option value="eft">EFT</option><option value="check">Check</option><option value="ach">ACH</option><option value="manual">Manual</option></select></Field><Field label="Trace #"><input className={inputClass} value={form.trace_number} onChange={(e)=>setForm({...form,trace_number:e.target.value})}/></Field></FieldGrid><div style={{marginTop:16}}><ActionButton onClick={save}>Save Payment</ActionButton></div></Modal>}</>;
}

export function ArDenialsPage() {
  const state=useLoad(async()=>{const[denials,clients,payers]=await Promise.all([tenantSelect("denials"),tenantSelect("clients"),referenceSelect("payers")]);return{denials,clients:byId(clients),payers:byId(payers)};});
  return <><WorkspaceHeader eyebrow="REVENUE RECOVERY" title="A/R & Denials" description="Denial follow-up with clear patient, payer, reason, balance and resolution actions."/><section className="thera-card"><State loading={state.loading} error={state.error}/>{state.data&&<div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Patient</th><th>Payer</th><th>Category</th><th>CARC / RARC</th><th>Amount</th><th>Workability</th><th>Status</th><th>Reason</th><th>Actions</th></tr></thead><tbody>{state.data.denials.map((d)=><tr key={d.id}><td>{shortDate(d.denial_date)}</td><td>{name(state.data!.clients.get(d.client_id))}</td><td>{state.data!.payers.get(d.payer_id)?.name||"—"}</td><td>{String(d.denial_category).replaceAll("_"," ")}</td><td>{d.carc_code||"—"} / {d.rarc_code||"—"}</td><td>{money(d.amount_cents)}</td><td><StatusBadge value={d.workability}/></td><td><StatusBadge value={d.denial_status}/></td><td>{d.reason||"—"}</td><td><div className="thera-filter-row"><ActionButton secondary onClick={async()=>{await tenantUpdate("denials",d.id,{denial_status:"reviewing"});state.reload();}}>Start Work</ActionButton><ActionButton secondary onClick={async()=>{await tenantInsert("appeals",{denial_id:d.id,claim_id:d.claim_id,appeal_status:"drafting",appeal_level:"first_level",notes:"Created from A/R & Denials workspace"});await tenantUpdate("denials",d.id,{denial_status:"appealed"});state.reload();}}>Appeal</ActionButton><ActionButton onClick={async()=>{await tenantUpdate("denials",d.id,{denial_status:"resolved_paid"});state.reload();}}>Resolve Paid</ActionButton></div></td></tr>)}</tbody></table></div>}</section></>;
}

export function CredentialingPage() {
  const state=useLoad(async()=>{const[enrollments,providers,payers]=await Promise.all([tenantSelect("provider_payer_enrollments"),tenantSelect("providers"),referenceSelect("payers")]);return{enrollments,providers:byId(providers),payers:byId(payers)};});
  const statuses=["not_started","in_progress","submitted","approved","denied","terminated","expired","needs_revalidation"];
  return <><WorkspaceHeader eyebrow="PAYER OPERATIONS" title="Credentialing" description="Provider-payer enrollment workqueue with direct status updates."/><section className="thera-card"><State loading={state.loading} error={state.error}/>{state.data&&<div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Provider</th><th>Payer</th><th>Status</th><th>Effective</th><th>Payer Provider ID</th><th>Notes</th><th>Action</th></tr></thead><tbody>{state.data.enrollments.map((e)=><tr key={e.id}><td>{name(state.data!.providers.get(e.provider_id))}</td><td>{state.data!.payers.get(e.payer_id)?.name||"—"}</td><td><StatusBadge value={e.enrollment_status}/></td><td>{shortDate(e.effective_date)}</td><td>{e.payer_provider_id||"—"}</td><td>{e.notes||"—"}</td><td><select className={inputClass} value={e.enrollment_status} onChange={async(ev)=>{await tenantUpdate("provider_payer_enrollments",e.id,{enrollment_status:ev.target.value});state.reload();}}>{statuses.map((s)=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></td></tr>)}</tbody></table></div>}</section></>;
}

export function PayersContractsPage() {
  const state=useLoad(async()=>{const[payers,contracts]=await Promise.all([referenceSelect("payers"),tenantSelect("payer_contracts")]);return{payers,contracts,payersById:byId(payers)};});
  const [showNew,setShowNew]=useState(false);const[form,setForm]=useState({payer_id:"",contract_name:"",status:"active",effective_date:""});
  async function save(){if(!form.payer_id||!form.contract_name)return;await tenantInsert("payer_contracts",form);setShowNew(false);state.reload();}
  return <><WorkspaceHeader eyebrow="CONTRACT INTELLIGENCE" title="Payers & Contracts" description="Payer reference data with tenant-specific contract management." action={<ActionButton onClick={()=>setShowNew(true)}>+ Add Contract</ActionButton>}/><section className="thera-card"><State loading={state.loading} error={state.error}/>{state.data&&<><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Payer</th><th>Type</th><th>Clearinghouse ID</th><th>Contract</th><th>Status</th><th>Effective</th><th>Actions</th></tr></thead><tbody>{state.data.payers.map((p)=>{const contracts=state.data!.contracts.filter((c)=>c.payer_id===p.id);return contracts.length?contracts.map((c)=><tr key={c.id}><td>{p.name}</td><td>{p.payer_type||"—"}</td><td>{p.clearinghouse_payer_id||"—"}</td><td>{c.contract_name}</td><td><StatusBadge value={c.status}/></td><td>{shortDate(c.effective_date)}</td><td><div className="thera-filter-row"><ActionButton secondary onClick={async()=>{await tenantUpdate("payer_contracts",c.id,{status:"active"});state.reload();}}>Activate</ActionButton><ActionButton secondary onClick={async()=>{await tenantUpdate("payer_contracts",c.id,{status:"terminated",termination_date:new Date().toISOString().slice(0,10)});state.reload();}}>Terminate</ActionButton></div></td></tr>):<tr key={p.id}><td>{p.name}</td><td>{p.payer_type||"—"}</td><td>{p.clearinghouse_payer_id||"—"}</td><td colSpan={4}>No contract on file</td></tr>})}</tbody></table></div></>}</section>{showNew&&state.data&&<Modal title="Add Payer Contract" onClose={()=>setShowNew(false)}><FieldGrid><Field label="Payer"><select className={inputClass} value={form.payer_id} onChange={(e)=>setForm({...form,payer_id:e.target.value})}><option value="">Select payer</option>{state.data.payers.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Contract Name"><input className={inputClass} value={form.contract_name} onChange={(e)=>setForm({...form,contract_name:e.target.value})}/></Field><Field label="Effective Date"><input className={inputClass} type="date" value={form.effective_date} onChange={(e)=>setForm({...form,effective_date:e.target.value})}/></Field></FieldGrid><div style={{marginTop:16}}><ActionButton onClick={save}>Save Contract</ActionButton></div></Modal>}</>;
}

export function MailroomPage() {
  const state=useLoad(async()=>{const[items,payers,claims,clients]=await Promise.all([tenantSelect("mailroom_items"),referenceSelect("payers"),tenantSelect("professional_claims"),tenantSelect("clients")]);return{items,payers:byId(payers),claims:byId(claims),clients:byId(clients),payerRows:payers,claimRows:claims};});
  const [showNew,setShowNew]=useState(false);const[form,setForm]=useState({subject:"",payer_id:"",claim_id:"",correspondence_type:"payer_correspondence",notes:""});
  async function save(){if(!form.subject)return;await tenantInsert("mailroom_items",{...form,payer_id:form.payer_id||null,claim_id:form.claim_id||null,status:"new",received_date:new Date().toISOString().slice(0,10)});setShowNew(false);state.reload();}
  return <><WorkspaceHeader eyebrow="CORRESPONDENCE OPERATIONS" title="Mailroom" description="Payer correspondence routed into operational work instead of a passive document list." action={<ActionButton onClick={()=>setShowNew(true)}>+ Add Correspondence</ActionButton>}/><section className="thera-card"><State loading={state.loading} error={state.error}/>{state.data&&<div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Received</th><th>Subject</th><th>Payer</th><th>Claim / Patient</th><th>Type</th><th>Status</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{state.data.items.map((m)=>{const claim=state.data!.claims.get(m.claim_id);return <tr key={m.id}><td>{shortDate(m.received_date)}</td><td>{m.subject}</td><td>{state.data!.payers.get(m.payer_id)?.name||"—"}</td><td>{claim?.patient_control_number||"—"}<div className="thera-table-subtext">{name(state.data!.clients.get(claim?.client_id))}</div></td><td>{String(m.correspondence_type).replaceAll("_"," ")}</td><td><StatusBadge value={m.status}/></td><td>{m.notes||"—"}</td><td><div className="thera-filter-row"><ActionButton secondary onClick={async()=>{await tenantUpdate("mailroom_items",m.id,{status:"in_progress"});state.reload();}}>Start Work</ActionButton><ActionButton onClick={async()=>{await tenantUpdate("mailroom_items",m.id,{status:"resolved"});state.reload();}}>Resolve</ActionButton></div></td></tr>})}</tbody></table></div>}</section>{showNew&&state.data&&<Modal title="Add Correspondence" onClose={()=>setShowNew(false)}><FieldGrid><Field label="Subject"><input className={inputClass} value={form.subject} onChange={(e)=>setForm({...form,subject:e.target.value})}/></Field><Field label="Payer"><select className={inputClass} value={form.payer_id} onChange={(e)=>setForm({...form,payer_id:e.target.value})}><option value="">Select payer</option>{state.data.payerRows.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Claim"><select className={inputClass} value={form.claim_id} onChange={(e)=>setForm({...form,claim_id:e.target.value})}><option value="">No linked claim</option>{state.data.claimRows.map((c)=><option key={c.id} value={c.id}>{c.patient_control_number||"Open Claim"}</option>)}</select></Field><Field label="Notes"><input className={inputClass} value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/></Field></FieldGrid><div style={{marginTop:16}}><ActionButton onClick={save}>Save Correspondence</ActionButton></div></Modal>}</>;
}

export function ReportsPage() {
  const state = useLoad(async () => {
    const [clients, providers, claims, balances, payments, denials, work] = await Promise.all([
      tenantSelect("clients"),
      tenantSelect("providers"),
      tenantSelect("professional_claims"),
      tenantSelect("claim_balance_summaries"),
      tenantSelect("payments"),
      tenantSelect("denials"),
      tenantSelect("workqueue_items"),
    ]);
    return { clients, providers, claims, balances, payments, denials, work };
  });

  const data = state.data;
  const balanceByClaim = new Map((data?.balances ?? []).map((row) => [String(row.claim_id), row]));
  const financialClaims = (data?.claims ?? []).filter(
    (claim) =>
      Number(claim.total_charge_cents ?? 0) > 0
      && !["voided", "reversed"].includes(String(claim.claim_status ?? "")),
  );
  const missingBalanceClaims = financialClaims.filter(
    (claim) => !balanceByClaim.has(String(claim.id)),
  );
  const reconciledClaims = financialClaims.filter(
    (claim) => balanceByClaim.has(String(claim.id)),
  );
  const openClaims = reconciledClaims.filter((claim) => {
    const balance = balanceByClaim.get(String(claim.id));
    return Number(balance?.open_balance_cents ?? 0) > 0;
  });
  const openAr = openClaims.reduce((sum, claim) => {
    const balance = balanceByClaim.get(String(claim.id));
    return sum + Number(balance?.open_balance_cents ?? 0);
  }, 0);
  const now = Date.now();
  const arOver90 = openClaims.reduce((sum, claim) => {
    const dos = String(claim.service_date_from ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dos)) return sum;
    const serviceDate = new Date(`${dos}T00:00:00Z`);
    if (!Number.isFinite(serviceDate.getTime())) return sum;
    const ageDays = Math.floor((now - serviceDate.getTime()) / 86_400_000);
    if (ageDays <= 90) return sum;
    const balance = balanceByClaim.get(String(claim.id));
    return sum + Number(balance?.open_balance_cents ?? 0);
  }, 0);
  const arOver90Percent = openAr > 0 ? (arOver90 / openAr) * 100 : 0;
  const claimAttention = (data?.claims ?? []).filter((claim) =>
    ["rejected", "denied", "validation_failed"].includes(String(claim.claim_status ?? "")),
  ).length;
  const openWork = (data?.work ?? []).filter((item) =>
    !["completed", "cancelled"].includes(String(item.workqueue_status ?? "")),
  ).length;
  const postedPaymentRows = (data?.payments ?? []).filter((payment) =>
    ["posted", "partially_applied"].includes(String(payment.payment_status ?? ""))
    && Boolean(payment.posted_at),
  );
  const postedPayments = postedPaymentRows.reduce(
    (sum, payment) => sum + Number(payment.amount_cents ?? 0),
    0,
  );
  const reversedPayments = (data?.payments ?? []).filter(
    (payment) => ["reversed", "voided"].includes(String(payment.payment_status ?? "")),
  ).length;

  return (
    <>
      <WorkspaceHeader
        eyebrow="OPERATE · MANAGEMENT VIEW"
        title="Reports"
        description="Operational and financial indicators reconcile to the same claims, payments, denials, and workqueues staff are actively using."
        action={
          <div className="thera-filter-row">
            <Link className="thera-action secondary" href="/claims">Claims</Link>
            <Link className="thera-action secondary" href="/payments">Payments</Link>
            <Link className="thera-action secondary" href="/denials">Denials</Link>
            <Link className="thera-action" href="/work-center">Work Center</Link>
          </div>
        }
      />
      <State loading={state.loading} error={state.error} />

      {data && (
        <>
          {missingBalanceClaims.length > 0 && (
            <div className="thera-state error" style={{ marginBottom: 16 }}>
              {missingBalanceClaims.length} financial claim(s) are missing a reconciled balance summary and are excluded from A/R totals until recalculated.
            </div>
          )}

          <div className="thera-metric-grid">
            <div className="thera-metric-card">
              <div className="thera-metric-label">Active Patients</div>
              <div className="thera-metric-value">{data.clients.filter((row) => row.client_status === "active").length}</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Active Providers</div>
              <div className="thera-metric-value">{data.providers.filter((row) => row.provider_status === "active").length}</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Open A/R</div>
              <div className="thera-metric-value">{money(openAr)}</div>
              <div className="thera-table-subtext">Reconciled claim balances only</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">A/R Over 90</div>
              <div className="thera-metric-value">{money(arOver90)}</div>
              <div className="thera-table-subtext">{arOver90Percent.toFixed(1)}% of reconciled open A/R · 91+ days from DOS</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Missing Balances</div>
              <div className="thera-metric-value">{missingBalanceClaims.length}</div>
              <div className="thera-table-subtext">Excluded from A/R denominator</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Claim Exceptions</div>
              <div className="thera-metric-value">{claimAttention}</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Active Denials</div>
              <div className="thera-metric-value">{data.denials.filter((row) => !["resolved", "resolved_writeoff", "closed"].includes(String(row.denial_status ?? ""))).length}</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Posted Payments</div>
              <div className="thera-metric-value">{money(postedPayments)}</div>
              <div className="thera-table-subtext">Posted or partially applied only · reversed/voided excluded</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Reversed / Voided Payments</div>
              <div className="thera-metric-value">{reversedPayments}</div>
              <div className="thera-table-subtext">Excluded from posted-payment total</div>
            </div>
            <div className="thera-metric-card">
              <div className="thera-metric-label">Open Work</div>
              <div className="thera-metric-value">{openWork}</div>
            </div>
          </div>

          <section className="thera-card">
            <div className="thera-card-header">
              <div>
                <h2>Management Follow-Up</h2>
                <p>A/R aging uses service date. The over-90 denominator is current reconciled open A/R; payment totals use posting status, not receipt/download activity.</p>
              </div>
            </div>
            <div className="thera-story-grid">
              <div className="thera-story">
                <strong>Claims requiring attention</strong>
                <p>{claimAttention} rejected, denied, or validation-failed claims need action.</p>
                <Link className="thera-link" href="/rejections">Open claim exceptions</Link>
              </div>
              <div className="thera-story">
                <strong>Revenue recovery</strong>
                <p>{money(arOver90)} of {money(openAr)} reconciled open A/R is 91+ days from service.</p>
                <Link className="thera-link" href="/claims">Open A/R follow-up</Link>
              </div>
              <div className="thera-story">
                <strong>Balance integrity</strong>
                <p>{missingBalanceClaims.length === 0 ? "All financial claims included in this report have balance summaries." : `${missingBalanceClaims.length} financial claim(s) require balance recalculation before management totals are complete.`}</p>
                <Link className="thera-link" href="/claims">Review claims</Link>
              </div>
              <div className="thera-story">
                <strong>Audit readiness</strong>
                <p>Review tenant activity history across clinical, financial, payer, and document actions.</p>
                <Link className="thera-link" href="/administration/audit">Open Audit History</Link>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
