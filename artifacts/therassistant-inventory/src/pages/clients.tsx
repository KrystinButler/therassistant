import { useState } from "react";
import { Link } from "wouter";
import { StatusBadge } from "../components/status-badge";
import { dateTime, money, shortDate } from "../lib/format";
import { demoInsert, demoUpdate } from "../lib/demo-data";
import { useApi } from "../lib/therassistant-api";

type ClientRow = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
  clientStatus: string;
  registrationStatus: string;
  billingReadinessStatus: string;
  payerName?: string | null;
  planName?: string | null;
  nextAppointment?: string | null;
  openBalanceCents?: number;
};

type FormState = {
  id?: string;
  first_name: string;
  last_name: string;
  preferred_name: string;
  date_of_birth: string;
  email: string;
  phone: string;
  client_status: string;
  registration_status: string;
};

const blank: FormState = {
  first_name: "",
  last_name: "",
  preferred_name: "",
  date_of_birth: "",
  email: "",
  phone: "",
  client_status: "active",
  registration_status: "complete",
};

export function ClientsPage() {
  const [search, setSearch] = useState("");
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState<FormState | null>(null);

  const { data, loading, error } = useApi<ClientRow[]>(
    `/api/clients?search=${encodeURIComponent(search)}&refresh=${version}`,
  );

  async function save() {
    if (!form?.first_name.trim() || !form.last_name.trim()) return;
    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      preferred_name: form.preferred_name || null,
      date_of_birth: form.date_of_birth || null,
      email: form.email || null,
      phone: form.phone || null,
      client_status: form.client_status,
      registration_status: form.registration_status,
    };
    if (form.id) await demoUpdate("clients", form.id, payload);
    else await demoInsert("clients", { ...payload, billing_readiness_status: "not_ready" });
    setForm(null);
    setVersion((v) => v + 1);
  }

  function edit(client: ClientRow) {
    setForm({
      id: client.id,
      first_name: client.firstName,
      last_name: client.lastName,
      preferred_name: client.preferredName || "",
      date_of_birth: client.dateOfBirth || "",
      email: client.email || "",
      phone: client.phone || "",
      client_status: client.clientStatus,
      registration_status: client.registrationStatus,
    });
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">PATIENT OPERATIONS</div>
          <h1>Patients</h1>
          <p>Clinical, payer, authorization, claim, payment, and work history in one record.</p>
        </div>
        <div className="thera-filter-row">
          <input className="thera-input" placeholder="Search patients..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="button" className="thera-action" onClick={() => setForm({ ...blank })}>+ Add Patient</button>
        </div>
      </div>

      <section className="thera-card">
        {loading && <div className="thera-state">Loading patients...</div>}
        {error && <div className="thera-state error">{error}</div>}
        {!loading && !error && <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Patient</th><th>DOB</th><th>Insurance</th><th>Registration</th><th>Billing Readiness</th><th>Next Appointment</th><th>Open Balance</th><th>Actions</th></tr></thead><tbody>
          {(data ?? []).map((client) => <tr key={client.id}>
            <td><Link href={`/clients/${client.id}`} className="thera-table-link">{client.firstName} {client.lastName}</Link><div className="thera-table-subtext"><StatusBadge value={client.clientStatus} /></div></td>
            <td>{shortDate(client.dateOfBirth)}</td>
            <td><strong>{client.payerName || "—"}</strong><div className="thera-table-subtext">{client.planName || ""}</div></td>
            <td><StatusBadge value={client.registrationStatus} /></td>
            <td><StatusBadge value={client.billingReadinessStatus} /></td>
            <td>{client.nextAppointment ? dateTime(client.nextAppointment) : "—"}</td>
            <td>{money(client.openBalanceCents)}</td>
            <td><button type="button" className="thera-action secondary" onClick={() => edit(client)}>Edit</button></td>
          </tr>)}
        </tbody></table></div>}
      </section>

      {form && <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.45)",display:"grid",placeItems:"center",zIndex:1000,padding:20}}><section className="thera-card" style={{width:"min(680px,100%)"}}><div className="thera-card-header"><div><h2>{form.id ? "Edit Patient" : "Add Patient"}</h2><p>Changes save directly to the synthetic Supabase demo.</p></div><button className="thera-action secondary" type="button" onClick={() => setForm(null)}>Close</button></div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
        <label><div className="thera-field-label">First Name</div><input className="thera-input" value={form.first_name} onChange={(e)=>setForm({...form,first_name:e.target.value})}/></label>
        <label><div className="thera-field-label">Last Name</div><input className="thera-input" value={form.last_name} onChange={(e)=>setForm({...form,last_name:e.target.value})}/></label>
        <label><div className="thera-field-label">Preferred Name</div><input className="thera-input" value={form.preferred_name} onChange={(e)=>setForm({...form,preferred_name:e.target.value})}/></label>
        <label><div className="thera-field-label">DOB</div><input className="thera-input" type="date" value={form.date_of_birth} onChange={(e)=>setForm({...form,date_of_birth:e.target.value})}/></label>
        <label><div className="thera-field-label">Email</div><input className="thera-input" type="email" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/></label>
        <label><div className="thera-field-label">Phone</div><input className="thera-input" value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})}/></label>
        <label><div className="thera-field-label">Patient Status</div><select className="thera-input" value={form.client_status} onChange={(e)=>setForm({...form,client_status:e.target.value})}><option value="active">Active</option><option value="intake">Intake</option><option value="waitlist">Waitlist</option><option value="inactive">Inactive</option><option value="discharged">Discharged</option></select></label>
        <label><div className="thera-field-label">Registration</div><select className="thera-input" value={form.registration_status} onChange={(e)=>setForm({...form,registration_status:e.target.value})}><option value="not_started">Not Started</option><option value="in_progress">In Progress</option><option value="pending_review">Pending Review</option><option value="complete">Complete</option><option value="needs_correction">Needs Correction</option></select></label>
      </div><div style={{marginTop:16}}><button type="button" className="thera-action" onClick={() => void save()}>Save Patient</button></div></section></div>}
    </>
  );
}
