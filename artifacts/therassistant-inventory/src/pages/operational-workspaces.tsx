import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { StatusBadge } from "../components/status-badge";
import { dateTime, money, shortDate } from "../lib/format";
import {
  demoInsert,
  demoRows,
  demoUpdate,
  referenceRows,
} from "../lib/demo-data";

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
      demoRows("appointments"), demoRows("clients"), demoRows("providers"),
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
    await demoInsert("appointments", {
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
              {appt.appointment_status === "scheduled" && <ActionButton secondary onClick={async () => { await demoUpdate("appointments", appt.id, { appointment_status: "confirmed" }); state.reload(); }}>Confirm</ActionButton>}
              {!['completed','cancelled','no_show'].includes(appt.appointment_status) && <ActionButton secondary onClick={async () => { await demoUpdate("appointments", appt.id, { appointment_status: "completed", completed_at: new Date().toISOString() }); state.reload(); }}>Complete</ActionButton>}
              {!['completed','cancelled','no_show'].includes(appt.appointment_status) && <ActionButton secondary onClick={async () => { await demoUpdate("appointments", appt.id, { appointment_status: "no_show" }); state.reload(); }}>No Show</ActionButton>}
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
    const [charges, clients, providers, payers] = await Promise.all([demoRows("charge_capture_items"), demoRows("clients"), demoRows("providers"), referenceRows("payers")]);
    return { charges, clients: byId(clients), providers: byId(providers), payers: byId(payers) };
  });

  async function createClaim(charge: Row) {
    await demoInsert("professional_claims", {
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
    await demoUpdate("charge_capture_items", charge.id, { charge_status: "claim_created", block_reason: null });
    state.reload();
  }

  return <><WorkspaceHeader eyebrow="BILLING READINESS" title="Charge Capture" description="Actionable charge workqueue with patient, provider, payer and billing readiness." />
    <section className="thera-card"><State loading={state.loading} error={state.error} />{state.data && <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>DOS</th><th>Patient</th><th>Provider</th><th>Payer</th><th>Service</th><th>Charge</th><th>Status</th><th>Issue</th><th>Actions</th></tr></thead><tbody>{state.data.charges.map((row) => <tr key={row.id}><td>{shortDate(row.service_date)}</td><td>{name(state.data!.clients.get(row.client_id))}</td><td>{name(state.data!.providers.get(row.provider_id))}</td><td>{state.data!.payers.get(row.payer_id)?.name || "—"}</td><td>{row.cpt_code}<div className="thera-table-subtext">Dx {row.diagnosis_code || "—"}</div></td><td>{money(row.charge_amount_cents)}</td><td><StatusBadge value={row.charge_status} /></td><td>{row.block_reason || "—"}</td><td><div className="thera-filter-row">{row.charge_status === "captured" && <ActionButton secondary onClick={async()=>{await demoUpdate("charge_capture_items",row.id,{charge_status:"ready_for_claim",block_reason:null});state.reload();}}>Ready for Claim</ActionButton>}{row.charge_status === "ready_for_claim" && <ActionButton onClick={() => createClaim(row)}>Create Claim</ActionButton>}{!['claim_created','voided'].includes(row.charge_status) && <ActionButton secondary onClick={async()=>{const reason=window.prompt("Block reason");if(reason){await demoUpdate("charge_capture_items",row.id,{charge_status:"blocked",block_reason:reason});state.reload();}}}>Block</ActionButton>}</div></td></tr>)}</tbody></table></div>}</section></>;
}

export function PaymentsPage() {
  const state = useLoad(async () => {
    const [payments, clients, payers] = await Promise.all([demoRows("payments"), demoRows("clients"), referenceRows("payers")]);
    return { payments, clients: byId(clients), payers: byId(payers), clientRows: clients, payerRows: payers };
  });
  const [showNew,setShowNew]=useState(false);
  const [form,setForm]=useState({client_id:"",payer_id:"",amount:"",payment_method:"eft",payment_source:"insurance",trace_number:""});
  async function save(){if(!form.amount)return;await demoInsert("payments",{client_id:form.client_id||null,payer_id:form.payer_id||null,payment_source:form.payment_source,payment_method:form.payment_method,payment_status:"pending",amount_cents:Math.round(Number(form.amount)*100),payment_date:new Date().toISOString().slice(0,10),trace_number:form.trace_number||null});setShowNew(false);state.reload();}
  return <><WorkspaceHeader eyebrow="REMITTANCE OPERATIONS" title="Payments" description="Payment posting workqueue with patient and payer context instead of internal IDs." action={<ActionButton onClick={()=>setShowNew(true)}>+ Add Payment</ActionButton>} /><section className="thera-card"><State loading={state.loading} error={state.error}/>{state.data&&<div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Patient</th><th>Payer</th><th>Source / Method</th><th>Amount</th><th>Trace</th><th>Status</th><th>Actions</th></tr></thead><tbody>{state.data.payments.map((p)=><tr key={p.id}><td>{shortDate(p.payment_date)}</td><td>{name(state.data!.clients.get(p.client_id))}</td><td>{state.data!.payers.get(p.payer_id)?.name||"—"}</td><td>{p.payment_source}<div className="thera-table-subtext">{p.payment_method}</div></td><td>{money(p.amount_cents)}</td><td>{p.trace_number||"—"}</td><td><StatusBadge value={p.payment_status}/></td><td><div className="thera-filter-row">{p.payment_status!=="posted"&&<ActionButton onClick={async()=>{await demoUpdate("payments",p.id,{payment_status:"posted",posted_at:new Date().toISOString()});state.reload();}}>Post</ActionButton>}<ActionButton secondary onClick={async()=>{await demoUpdate("payments",p.id,{payment_status:"unapplied"});state.reload();}}>Mark Unapplied</ActionButton></div></td></tr>)}</tbody></table></div>}</section>{showNew&&state.data&&<Modal title="Add Payment" onClose={()=>setShowNew(false)}><FieldGrid><Field label="Patient"><select className={inputClass} value={form.client_id} onChange={(e)=>setForm({...form,client_id:e.target.value})}><option value="">Unassigned</option>{state.data.clientRows.map((c)=><option key={c.id} value={c.id}>{name(c)}</option>)}</select></Field><Field label="Payer"><select className={inputClass} value={form.payer_id} onChange={(e)=>setForm({...form,payer_id:e.target.value})}><option value="">Select payer</option>{state.data.payerRows.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Amount"><input className={inputClass} type="number" step="0.01" value={form.amount} onChange={(e)=>setForm({...form,amount:e.target.value})}/></Field><Field label="Method"><select className={inputClass} value={form.payment_method} onChange={(e)=>setForm({...form,payment_method:e.target.value})}><option value="eft">EFT</option><option value="check">Check</option><option value="ach">ACH</option><option value="manual">Manual</option></select></Field><Field label="Trace #"><input className={inputClass} value={form.trace_number} onChange={(e)=>setForm({...form,trace_number:e.target.value})}/></Field></FieldGrid><div style={{marginTop:16}}><ActionButton onClick={save}>Save Payment</ActionButton></div></Modal>}</>;
}

export function ArDenialsPage() {
  const state=useLoad(async()=>{const[denials,clients,payers]=await Promise.all([demoRows("denials"),demoRows("clients"),referenceRows("payers")]);return{denials,clients:byId(clients),payers:byId(payers)};});
  return <><WorkspaceHeader eyebrow="REVENUE RECOVERY" title="A/R & Denials" description="Denial follow-up with clear patient, payer, reason, balance and resolution actions."/><section className="thera-card"><State loading={state.loading} error={state.error}/>{state.data&&<div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Patient</th><th>Payer</th><th>Category</th><th>CARC / RARC</th><th>Amount</th><th>Workability</th><th>Status</th><th>Reason</th><th>Actions</th></tr></thead><tbody>{state.data.denials.map((d)=><tr key={d.id}><td>{shortDate(d.denial_date)}</td><td>{name(state.data!.clients.get(d.client_id))}</td><td>{state.data!.payers.get(d.payer_id)?.name||"—"}</td><td>{String(d.denial_category).replaceAll("_"," ")}</td><td>{d.carc_code||"—"} / {d.rarc_code||"—"}</td><td>{money(d.amount_cents)}</td><td><StatusBadge value={d.workability}/></td><td><StatusBadge value={d.denial_status}/></td><td>{d.reason||"—"}</td><td><div className="thera-filter-row"><ActionButton secondary onClick={async()=>{await demoUpdate("denials",d.id,{denial_status:"reviewing"});state.reload();}}>Start Work</ActionButton><ActionButton secondary onClick={async()=>{await demoInsert("appeals",{denial_id:d.id,claim_id:d.claim_id,appeal_status:"drafting",appeal_level:"first_level",notes:"Created from A/R & Denials workspace"});await demoUpdate("denials",d.id,{denial_status:"appealed"});state.reload();}}>Appeal</ActionButton><ActionButton onClick={async()=>{await demoUpdate("denials",d.id,{denial_status:"resolved_paid"});state.reload();}}>Resolve Paid</ActionButton></div></td></tr>)}</tbody></table></div>}</section></>;
}

export function CredentialingPage() {
  const state=useLoad(async()=>{const[enrollments,providers,payers]=await Promise.all([demoRows("provider_payer_enrollments"),demoRows("providers"),referenceRows("payers")]);return{enrollments,providers:byId(providers),payers:byId(payers)};});
  const statuses=["not_started","in_progress","submitted","approved","denied","terminated","expired","needs_revalidation"];
  return <><WorkspaceHeader eyebrow="PAYER OPERATIONS" title="Credentialing" description="Provider-payer enrollment workqueue with direct status updates."/><section className="thera-card"><State loading={state.loading} error={state.error}/>{state.data&&<div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Provider</th><th>Payer</th><th>Status</th><th>Effective</th><th>Payer Provider ID</th><th>Notes</th><th>Action</th></tr></thead><tbody>{state.data.enrollments.map((e)=><tr key={e.id}><td>{name(state.data!.providers.get(e.provider_id))}</td><td>{state.data!.payers.get(e.payer_id)?.name||"—"}</td><td><StatusBadge value={e.enrollment_status}/></td><td>{shortDate(e.effective_date)}</td><td>{e.payer_provider_id||"—"}</td><td>{e.notes||"—"}</td><td><select className={inputClass} value={e.enrollment_status} onChange={async(ev)=>{await demoUpdate("provider_payer_enrollments",e.id,{enrollment_status:ev.target.value});state.reload();}}>{statuses.map((s)=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></td></tr>)}</tbody></table></div>}</section></>;
}

export function PayersContractsPage() {
  const state=useLoad(async()=>{const[payers,contracts]=await Promise.all([referenceRows("payers"),demoRows("payer_contracts")]);return{payers,contracts,payersById:byId(payers)};});
  const [showNew,setShowNew]=useState(false);const[form,setForm]=useState({payer_id:"",contract_name:"",status:"active",effective_date:""});
  async function save(){if(!form.payer_id||!form.contract_name)return;await demoInsert("payer_contracts",form);setShowNew(false);state.reload();}
  return <><WorkspaceHeader eyebrow="CONTRACT INTELLIGENCE" title="Payers & Contracts" description="Payer reference data with tenant-specific contract management." action={<ActionButton onClick={()=>setShowNew(true)}>+ Add Contract</ActionButton>}/><section className="thera-card"><State loading={state.loading} error={state.error}/>{state.data&&<><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Payer</th><th>Type</th><th>Clearinghouse ID</th><th>Contract</th><th>Status</th><th>Effective</th><th>Actions</th></tr></thead><tbody>{state.data.payers.map((p)=>{const contracts=state.data!.contracts.filter((c)=>c.payer_id===p.id);return contracts.length?contracts.map((c)=><tr key={c.id}><td>{p.name}</td><td>{p.payer_type||"—"}</td><td>{p.clearinghouse_payer_id||"—"}</td><td>{c.contract_name}</td><td><StatusBadge value={c.status}/></td><td>{shortDate(c.effective_date)}</td><td><div className="thera-filter-row"><ActionButton secondary onClick={async()=>{await demoUpdate("payer_contracts",c.id,{status:"active"});state.reload();}}>Activate</ActionButton><ActionButton secondary onClick={async()=>{await demoUpdate("payer_contracts",c.id,{status:"terminated",termination_date:new Date().toISOString().slice(0,10)});state.reload();}}>Terminate</ActionButton></div></td></tr>):<tr key={p.id}><td>{p.name}</td><td>{p.payer_type||"—"}</td><td>{p.clearinghouse_payer_id||"—"}</td><td colSpan={4}>No contract on file</td></tr>})}</tbody></table></div></>}</section>{showNew&&state.data&&<Modal title="Add Payer Contract" onClose={()=>setShowNew(false)}><FieldGrid><Field label="Payer"><select className={inputClass} value={form.payer_id} onChange={(e)=>setForm({...form,payer_id:e.target.value})}><option value="">Select payer</option>{state.data.payers.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Contract Name"><input className={inputClass} value={form.contract_name} onChange={(e)=>setForm({...form,contract_name:e.target.value})}/></Field><Field label="Effective Date"><input className={inputClass} type="date" value={form.effective_date} onChange={(e)=>setForm({...form,effective_date:e.target.value})}/></Field></FieldGrid><div style={{marginTop:16}}><ActionButton onClick={save}>Save Contract</ActionButton></div></Modal>}</>;
}

export function MailroomPage() {
  const state=useLoad(async()=>{const[items,payers,claims,clients]=await Promise.all([demoRows("mailroom_items"),referenceRows("payers"),demoRows("professional_claims"),demoRows("clients")]);return{items,payers:byId(payers),claims:byId(claims),clients:byId(clients),payerRows:payers,claimRows:claims};});
  const [showNew,setShowNew]=useState(false);const[form,setForm]=useState({subject:"",payer_id:"",claim_id:"",correspondence_type:"payer_correspondence",notes:""});
  async function save(){if(!form.subject)return;await demoInsert("mailroom_items",{...form,payer_id:form.payer_id||null,claim_id:form.claim_id||null,status:"new",received_date:new Date().toISOString().slice(0,10)});setShowNew(false);state.reload();}
  return <><WorkspaceHeader eyebrow="CORRESPONDENCE OPERATIONS" title="Mailroom" description="Payer correspondence routed into operational work instead of a passive document list." action={<ActionButton onClick={()=>setShowNew(true)}>+ Add Correspondence</ActionButton>}/><section className="thera-card"><State loading={state.loading} error={state.error}/>{state.data&&<div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Received</th><th>Subject</th><th>Payer</th><th>Claim / Patient</th><th>Type</th><th>Status</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{state.data.items.map((m)=>{const claim=state.data!.claims.get(m.claim_id);return <tr key={m.id}><td>{shortDate(m.received_date)}</td><td>{m.subject}</td><td>{state.data!.payers.get(m.payer_id)?.name||"—"}</td><td>{claim?.patient_control_number||"—"}<div className="thera-table-subtext">{name(state.data!.clients.get(claim?.client_id))}</div></td><td>{String(m.correspondence_type).replaceAll("_"," ")}</td><td><StatusBadge value={m.status}/></td><td>{m.notes||"—"}</td><td><div className="thera-filter-row"><ActionButton secondary onClick={async()=>{await demoUpdate("mailroom_items",m.id,{status:"in_progress"});state.reload();}}>Start Work</ActionButton><ActionButton onClick={async()=>{await demoUpdate("mailroom_items",m.id,{status:"resolved"});state.reload();}}>Resolve</ActionButton></div></td></tr>})}</tbody></table></div>}</section>{showNew&&state.data&&<Modal title="Add Correspondence" onClose={()=>setShowNew(false)}><FieldGrid><Field label="Subject"><input className={inputClass} value={form.subject} onChange={(e)=>setForm({...form,subject:e.target.value})}/></Field><Field label="Payer"><select className={inputClass} value={form.payer_id} onChange={(e)=>setForm({...form,payer_id:e.target.value})}><option value="">Select payer</option>{state.data.payerRows.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Claim"><select className={inputClass} value={form.claim_id} onChange={(e)=>setForm({...form,claim_id:e.target.value})}><option value="">No linked claim</option>{state.data.claimRows.map((c)=><option key={c.id} value={c.id}>{c.patient_control_number||"Open Claim"}</option>)}</select></Field><Field label="Notes"><input className={inputClass} value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/></Field></FieldGrid><div style={{marginTop:16}}><ActionButton onClick={save}>Save Correspondence</ActionButton></div></Modal>}</>;
}

export function ReportsPage() {
  const state=useLoad(async()=>{const[clients,providers,claims,payments,denials,work]=await Promise.all([demoRows("clients"),demoRows("providers"),demoRows("professional_claims"),demoRows("payments"),demoRows("denials"),demoRows("workqueue_items")]);return{clients,providers,claims,payments,denials,work};});
  return <><WorkspaceHeader eyebrow="OPERATIONAL INTELLIGENCE" title="Reports" description="Executive view with operational drill-downs instead of raw database fields." action={<div className="thera-filter-row"><Link className="thera-action secondary" href="/claims">Claims</Link><Link className="thera-action secondary" href="/payments">Payments</Link><Link className="thera-action secondary" href="/ar-denials">A/R & Denials</Link><Link className="thera-action" href="/work-center">Work Center</Link></div>}/><State loading={state.loading} error={state.error}/>{state.data&&<><div className="thera-metric-grid"><div className="thera-metric-card"><div className="thera-metric-label">Active Patients</div><div className="thera-metric-value">{state.data.clients.filter(c=>c.client_status==='active').length}</div></div><div className="thera-metric-card"><div className="thera-metric-label">Active Providers</div><div className="thera-metric-value">{state.data.providers.filter(p=>p.provider_status==='active').length}</div></div><div className="thera-metric-card"><div className="thera-metric-label">Open Claims</div><div className="thera-metric-value">{state.data.claims.filter(c=>!['paid','voided','reversed'].includes(c.claim_status)).length}</div></div><div className="thera-metric-card"><div className="thera-metric-label">Denials</div><div className="thera-metric-value">{state.data.denials.length}</div></div><div className="thera-metric-card"><div className="thera-metric-label">Payments</div><div className="thera-metric-value">{money(state.data.payments.reduce((s,p)=>s+Number(p.amount_cents||0),0))}</div></div><div className="thera-metric-card"><div className="thera-metric-label">Open Work</div><div className="thera-metric-value">{state.data.work.filter(w=>!['completed','cancelled'].includes(w.workqueue_status)).length}</div></div></div><section className="thera-card"><div className="thera-card-header"><div><h2>Operational Follow-Up</h2><p>Use the workspaces above for action; reports remain summary and drill-down focused.</p></div></div><div className="thera-story-grid"><div className="thera-story"><strong>Claims requiring attention</strong><p>{state.data.claims.filter(c=>['rejected','denied','validation_failed'].includes(c.claim_status)).length} claims need follow-up.</p></div><div className="thera-story"><strong>Credentialing impact</strong><p>Review provider participation before claim submission.</p><Link className="thera-link" href="/credentialing">Open Credentialing</Link></div><div className="thera-story"><strong>Revenue recovery</strong><p>{state.data.denials.length} denial records are available for resolution.</p><Link className="thera-link" href="/ar-denials">Open A/R & Denials</Link></div></div></section></>}</>;
}
