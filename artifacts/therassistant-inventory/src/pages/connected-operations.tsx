import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "../components/status-badge";
import { dateTime } from "../lib/format";
import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  type Row,
} from "../lib/tenant-data-client";

type DataRow = Row & { id: string };

function personName(row?: DataRow) {
  if (!row) return "Record unavailable";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function ConnectedOperationsPage() {
  const [clients, setClients] = useState<DataRow[]>([]);
  const [providers, setProviders] = useState<DataRow[]>([]);
  const [appointments, setAppointments] = useState<DataRow[]>([]);
  const [reminders, setReminders] = useState<DataRow[]>([]);
  const [referrals, setReferrals] = useState<DataRow[]>([]);
  const [records, setRecords] = useState<DataRow[]>([]);
  const [screenings, setScreenings] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [referral, setReferral] = useState({
    clientId: "",
    destinationName: "",
    specialty: "",
    payerName: "",
    reason: "",
  });
  const [recordRequest, setRecordRequest] = useState({
    clientId: "",
    requesterName: "",
    direction: "outbound",
    requestType: "medical_records",
    dueDate: "",
  });
  const [screening, setScreening] = useState({
    subjectType: "client",
    subjectId: "",
    screeningType: "consent_and_release_review",
    dueDate: today(),
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [clientRows, providerRows, appointmentRows, reminderRows, referralRows, recordRows, screeningRows] =
        await Promise.all([
          tenantSelect<DataRow>("clients", { deleted_at: "is.null", order: "last_name.asc" }),
          tenantSelect<DataRow>("providers", { order: "last_name.asc" }),
          tenantSelect<DataRow>("appointments", { order: "starts_at.asc" }),
          tenantSelect<DataRow>("appointment_reminders", { order: "scheduled_for.asc" }),
          tenantSelect<DataRow>("referral_outs", { order: "created_at.desc" }),
          tenantSelect<DataRow>("records_requests", { order: "created_at.desc" }),
          tenantSelect<DataRow>("compliance_screenings", { order: "due_date.asc" }),
        ]);
      setClients(clientRows);
      setProviders(providerRows);
      setAppointments(appointmentRows);
      setReminders(reminderRows);
      setReferrals(referralRows);
      setRecords(recordRows);
      setScreenings(screeningRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load connected operations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const clientById = useMemo(() => new Map(clients.map((row) => [row.id, row])), [clients]);
  const providerById = useMemo(() => new Map(providers.map((row) => [row.id, row])), [providers]);
  const appointmentById = useMemo(() => new Map(appointments.map((row) => [row.id, row])), [appointments]);

  async function run(action: () => Promise<unknown>, success: string) {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed.");
    } finally {
      setWorking(false);
    }
  }

  async function addReferral() {
    if (!referral.clientId || !referral.destinationName.trim()) return;
    await run(
      () => tenantInsert("referral_outs", {
        client_id: referral.clientId,
        destination_name: referral.destinationName.trim(),
        specialty: referral.specialty.trim() || null,
        payer_name: referral.payerName.trim() || null,
        reason: referral.reason.trim() || null,
        status: "sent",
        referred_at: new Date().toISOString(),
      }),
      "Referral-out record created.",
    );
    setReferral({ clientId: "", destinationName: "", specialty: "", payerName: "", reason: "" });
  }

  async function addRecordRequest() {
    if (!recordRequest.requesterName.trim()) return;
    await run(
      () => tenantInsert("records_requests", {
        client_id: recordRequest.clientId || null,
        requester_name: recordRequest.requesterName.trim(),
        request_direction: recordRequest.direction,
        request_type: recordRequest.requestType,
        due_date: recordRequest.dueDate || null,
        status: "received",
      }),
      "Records request created.",
    );
    setRecordRequest({ clientId: "", requesterName: "", direction: "outbound", requestType: "medical_records", dueDate: "" });
  }

  async function addScreening() {
    if (!screening.subjectId || !screening.screeningType.trim()) return;
    await run(
      () => tenantInsert("compliance_screenings", {
        client_id: screening.subjectType === "client" ? screening.subjectId : null,
        provider_id: screening.subjectType === "provider" ? screening.subjectId : null,
        screening_type: screening.screeningType.trim(),
        status: "due",
        due_date: screening.dueDate || null,
      }),
      "Compliance screening added.",
    );
    setScreening({ ...screening, subjectId: "" });
  }

  if (loading) return <div className="thera-state">Loading connected operations...</div>;

  return (
    <>
      <div className="thera-page-header">
        <div className="thera-eyebrow">OPERATE · CONNECTED WORKFLOWS</div>
        <h1>Connected Operations</h1>
        <p>Appointment reminders, referral-out work, records requests, and compliance screening tied to the same patient and provider records.</p>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {notice && <div className="thera-alert" style={{ marginBottom: 12 }}>{notice}</div>}

      <div className="thera-metric-grid" style={{ marginBottom: 16 }}>
        <Metric label="Pending reminders" value={reminders.filter((row) => row.status === "pending").length} />
        <Metric label="Open referrals" value={referrals.filter((row) => !["closed", "declined"].includes(String(row.status ?? ""))).length} />
        <Metric label="Open records requests" value={records.filter((row) => !["closed", "cancelled"].includes(String(row.status ?? ""))).length} />
        <Metric label="Screenings due / flagged" value={screenings.filter((row) => ["due", "in_progress", "flagged", "expired"].includes(String(row.status ?? ""))).length} />
      </div>

      <section className="thera-card" style={{ marginBottom: 16 }}>
        <div className="thera-card-header"><div><h2>Appointment Reminders</h2><p>Future scheduled and confirmed appointments automatically generate 24-hour email/SMS queue entries when contact data is available.</p></div></div>
        <div className="thera-table-wrap">
          <table className="thera-table">
            <thead><tr><th>Patient</th><th>Appointment</th><th>Channel</th><th>Scheduled</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {reminders.map((row) => {
                const appointment = appointmentById.get(String(row.appointment_id ?? ""));
                const client = appointment ? clientById.get(String(appointment.client_id ?? "")) : undefined;
                return (
                  <tr key={row.id}>
                    <td>{personName(client)}</td>
                    <td>{appointment?.starts_at ? dateTime(String(appointment.starts_at)) : "—"}</td>
                    <td>{String(row.channel ?? "—").toUpperCase()}</td>
                    <td>{row.scheduled_for ? dateTime(String(row.scheduled_for)) : "—"}</td>
                    <td><StatusBadge value={String(row.status ?? "pending")} /></td>
                    <td>
                      {row.status === "pending" ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="thera-action secondary" disabled={working} onClick={() => void run(
                            () => tenantUpdate("appointment_reminders", row.id, { status: "sent", sent_at: new Date().toISOString(), failure_reason: null }),
                            "Reminder marked sent.",
                          )}>Sent</button>
                          <button className="thera-action secondary" disabled={working} onClick={() => void run(
                            () => tenantUpdate("appointment_reminders", row.id, { status: "cancelled" }),
                            "Reminder cancelled.",
                          )}>Cancel</button>
                        </div>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
              {reminders.length === 0 && <tr><td colSpan={6}><div className="thera-empty">No reminder queue entries.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="thera-detail-grid">
        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Referral Out</h2><p>Keep referral destination and disposition with the patient chart.</p></div></div>
          <div className="thera-form-grid">
            <label>Patient<select className="thera-input" value={referral.clientId} onChange={(e) => setReferral({ ...referral, clientId: e.target.value })}><option value="">Select patient</option>{clients.map((row) => <option key={row.id} value={row.id}>{personName(row)}</option>)}</select></label>
            <label>Destination<input className="thera-input" value={referral.destinationName} onChange={(e) => setReferral({ ...referral, destinationName: e.target.value })} /></label>
            <label>Specialty<input className="thera-input" value={referral.specialty} onChange={(e) => setReferral({ ...referral, specialty: e.target.value })} /></label>
            <label>Payer / Network<input className="thera-input" value={referral.payerName} onChange={(e) => setReferral({ ...referral, payerName: e.target.value })} /></label>
            <label style={{ gridColumn: "1 / -1" }}>Reason<input className="thera-input" value={referral.reason} onChange={(e) => setReferral({ ...referral, reason: e.target.value })} /></label>
          </div>
          <button className="thera-action" disabled={working || !referral.clientId || !referral.destinationName.trim()} onClick={() => void addReferral()}>Add Referral</button>
          <div className="thera-table-wrap" style={{ marginTop: 14 }}>
            <table className="thera-table"><thead><tr><th>Patient</th><th>Destination</th><th>Status</th><th>Update</th></tr></thead><tbody>
              {referrals.map((row) => <tr key={row.id}>
                <td>{personName(clientById.get(String(row.client_id ?? "")))}</td>
                <td><strong>{String(row.destination_name ?? "—")}</strong><div className="thera-table-subtext">{String(row.specialty ?? row.payer_name ?? "")}</div></td>
                <td><StatusBadge value={String(row.status ?? "draft")} /></td>
                <td><select className="thera-input" value={String(row.status ?? "draft")} onChange={(e) => void run(() => tenantUpdate("referral_outs", row.id, {
                  status: e.target.value,
                  closed_at: e.target.value === "closed" ? new Date().toISOString() : null,
                }), "Referral status updated.")}>
                  {["draft","sent","accepted","scheduled","declined","closed"].map((status) => <option key={status} value={status}>{status.replaceAll("_"," ")}</option>)}
                </select></td>
              </tr>)}
            </tbody></table>
          </div>
        </section>

        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Records Requests</h2><p>Track inbound and outbound records work, due dates, delivery, and linked documents.</p></div></div>
          <div className="thera-form-grid">
            <label>Patient<select className="thera-input" value={recordRequest.clientId} onChange={(e) => setRecordRequest({ ...recordRequest, clientId: e.target.value })}><option value="">Not patient-specific</option>{clients.map((row) => <option key={row.id} value={row.id}>{personName(row)}</option>)}</select></label>
            <label>Requester<input className="thera-input" value={recordRequest.requesterName} onChange={(e) => setRecordRequest({ ...recordRequest, requesterName: e.target.value })} /></label>
            <label>Direction<select className="thera-input" value={recordRequest.direction} onChange={(e) => setRecordRequest({ ...recordRequest, direction: e.target.value })}><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></label>
            <label>Type<input className="thera-input" value={recordRequest.requestType} onChange={(e) => setRecordRequest({ ...recordRequest, requestType: e.target.value })} /></label>
            <label>Due Date<input type="date" className="thera-input" value={recordRequest.dueDate} onChange={(e) => setRecordRequest({ ...recordRequest, dueDate: e.target.value })} /></label>
          </div>
          <button className="thera-action" disabled={working || !recordRequest.requesterName.trim()} onClick={() => void addRecordRequest()}>Add Request</button>
          <div className="thera-table-wrap" style={{ marginTop: 14 }}>
            <table className="thera-table"><thead><tr><th>Patient</th><th>Requester</th><th>Due</th><th>Status</th></tr></thead><tbody>
              {records.map((row) => <tr key={row.id}>
                <td>{row.client_id ? personName(clientById.get(String(row.client_id))) : "—"}</td>
                <td>{String(row.requester_name ?? "—")}<div className="thera-table-subtext">{String(row.request_direction ?? "").replaceAll("_"," ")} · {String(row.request_type ?? "").replaceAll("_"," ")}</div></td>
                <td>{String(row.due_date ?? "—")}</td>
                <td><select className="thera-input" value={String(row.status ?? "received")} onChange={(e) => void run(() => tenantUpdate("records_requests", row.id, { status: e.target.value }), "Records request updated.")}>
                  {["received","reviewing","awaiting_authorization","ready","sent","closed","cancelled"].map((status) => <option key={status} value={status}>{status.replaceAll("_"," ")}</option>)}
                </select></td>
              </tr>)}
            </tbody></table>
          </div>
        </section>
      </div>

      <section className="thera-card" style={{ marginTop: 16 }}>
        <div className="thera-card-header"><div><h2>Compliance Screening</h2><p>Track due, clear, flagged, waived, and expired screening items for patients or providers.</p></div></div>
        <div className="thera-form-grid">
          <label>Subject Type<select className="thera-input" value={screening.subjectType} onChange={(e) => setScreening({ ...screening, subjectType: e.target.value, subjectId: "" })}><option value="client">Patient</option><option value="provider">Provider</option></select></label>
          <label>Subject<select className="thera-input" value={screening.subjectId} onChange={(e) => setScreening({ ...screening, subjectId: e.target.value })}><option value="">Select</option>{(screening.subjectType === "client" ? clients : providers).map((row) => <option key={row.id} value={row.id}>{personName(row)}</option>)}</select></label>
          <label>Screening<input className="thera-input" value={screening.screeningType} onChange={(e) => setScreening({ ...screening, screeningType: e.target.value })} /></label>
          <label>Due Date<input type="date" className="thera-input" value={screening.dueDate} onChange={(e) => setScreening({ ...screening, dueDate: e.target.value })} /></label>
        </div>
        <button className="thera-action" disabled={working || !screening.subjectId || !screening.screeningType.trim()} onClick={() => void addScreening()}>Add Screening</button>
        <div className="thera-table-wrap" style={{ marginTop: 14 }}>
          <table className="thera-table"><thead><tr><th>Subject</th><th>Screening</th><th>Due</th><th>Status</th></tr></thead><tbody>
            {screenings.map((row) => {
              const subject = row.client_id
                ? personName(clientById.get(String(row.client_id)))
                : personName(providerById.get(String(row.provider_id ?? "")));
              return <tr key={row.id}>
                <td>{subject}</td>
                <td>{String(row.screening_type ?? "—").replaceAll("_"," ")}</td>
                <td>{String(row.due_date ?? "—")}</td>
                <td><select className="thera-input" value={String(row.status ?? "due")} onChange={(e) => void run(() => tenantUpdate("compliance_screenings", row.id, {
                  status: e.target.value,
                  completed_at: ["clear","flagged","waived"].includes(e.target.value) ? new Date().toISOString() : null,
                }), "Compliance screening updated.")}>
                  {["due","in_progress","clear","flagged","waived","expired"].map((status) => <option key={status} value={status}>{status.replaceAll("_"," ")}</option>)}
                </select></td>
              </tr>;
            })}
          </tbody></table>
        </div>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="thera-metric-card"><div className="thera-metric-label">{label}</div><div className="thera-metric-value small">{value}</div></div>;
}
