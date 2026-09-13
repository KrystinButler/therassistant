import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";

import { StatusBadge } from "../components/status-badge";
import { dateTime, money, shortDate, textValue } from "../lib/format";
import { useApi } from "../lib/therassistant-api";
import { getClientChartRelationships } from "../domains/clients/repository";

type Row = Record<string, any>;

type ClientDetail = {
  client: Row;
  insurancePolicies: Row[];
  appointments: Row[];
  treatmentPlans: Row[];
  clinicalNotes: Row[];
  charges: Row[];
  claims: Row[];
  payments: Row[];
  denials: Row[];
  workItems: Row[];
};

type ChartData = Awaited<ReturnType<typeof getClientChartRelationships>>;

type Tab =
  | "Overview"
  | "Encounters"
  | "Insurance"
  | "Appointments"
  | "Treatment Plans"
  | "Clinical Notes"
  | "Charges"
  | "Claims"
  | "Payments"
  | "Denials"
  | "Work Items";

const tabs: Tab[] = [
  "Overview",
  "Encounters",
  "Insurance",
  "Appointments",
  "Treatment Plans",
  "Clinical Notes",
  "Charges",
  "Claims",
  "Payments",
  "Denials",
  "Work Items",
];

export function ClientDetailPage() {
  const [, params] = useRoute<{ id: string }>("/clients/:id");
  const clientId = params?.id ?? "";
  const [tab, setTab] = useState<Tab>("Overview");
  const [chart, setChart] = useState<ChartData | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const { data, loading, error } = useApi<ClientDetail>(`/api/clients/${clientId}`);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    setChartError(null);
    void getClientChartRelationships(clientId)
      .then((result) => {
        if (active) setChart(result);
      })
      .catch((err) => {
        if (active) setChartError(err instanceof Error ? err.message : "Unable to load encounter relationships.");
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  const linkedWorkItems = useMemo(() => {
    const rows = [...(data?.workItems ?? []), ...(chart?.workItems ?? [])];
    return [...new Map(rows.map((row) => [row.id, row])).values()];
  }, [data?.workItems, chart?.workItems]);

  if (loading) return <div className="thera-state">Loading client...</div>;
  if (error || !data) return <div className="thera-state error">{error || "Client not found."}</div>;

  const client = data.client;
  const displayName = `${
    textValue(client, "preferred_name") !== "—"
      ? textValue(client, "preferred_name")
      : textValue(client, "first_name")
  } ${textValue(client, "last_name")}`;

  return (
    <>
      <div className="thera-breadcrumb">
        <Link href="/clients" className="thera-link">Clients</Link>
        <span>/</span>
        <span>{displayName}</span>
      </div>

      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">CLIENT 360</div>
          <h1>{displayName}</h1>
          <p>
            DOB {shortDate(textValue(client, "date_of_birth"))} · {textValue(client, "email")} · {textValue(client, "phone")}
          </p>
        </div>
        <div className="thera-header-badges">
          <StatusBadge value={textValue(client, "client_status")} />
          <StatusBadge value={textValue(client, "billing_readiness_status")} />
        </div>
      </div>

      <div className="thera-tabs" style={{ marginBottom: 16 }}>
        {tabs.map((name) => (
          <button
            type="button"
            key={name}
            className={tab === name ? "thera-tab active" : "thera-tab"}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {chartError && <div className="thera-state error" style={{ marginBottom: 12 }}>{chartError}</div>}

      {tab === "Overview" && <Overview data={data} encounterCount={chart?.encounters.length ?? 0} workCount={linkedWorkItems.length} />}
      {tab === "Encounters" && <Encounters rows={chart?.encounters ?? []} />}
      {tab === "Insurance" && <SimpleTable rows={data.insurancePolicies} columns={[
        ["Payer", "payerName"], ["Plan", "planName"], ["Member ID", "member_id"], ["Order", "insurance_order"], ["Effective", "effective_date"], ["Status", "status"],
      ]} statusFields={["status"]} dateFields={["effective_date"]} />}
      {tab === "Appointments" && <Appointments rows={data.appointments} />}
      {tab === "Treatment Plans" && <SimpleTable rows={data.treatmentPlans} columns={[
        ["Provider", "providerName"], ["Effective", "effective_date"], ["Review Due", "review_due_date"], ["Status", "status"], ["Plan", "plan_text"],
      ]} statusFields={["status"]} dateFields={["effective_date", "review_due_date"]} />}
      {tab === "Clinical Notes" && <ClinicalNotes rows={data.clinicalNotes} />}
      {tab === "Charges" && <SimpleTable rows={data.charges} columns={[
        ["Service Date", "service_date"], ["Provider", "providerName"], ["Payer", "payerName"], ["CPT", "cpt_code"], ["Charge", "charge_amount_cents"], ["Status", "charge_status"], ["Block", "block_reason"],
      ]} statusFields={["charge_status"]} moneyFields={["charge_amount_cents"]} dateFields={["service_date"]} />}
      {tab === "Claims" && <Claims rows={data.claims} />}
      {tab === "Payments" && <SimpleTable rows={data.payments} columns={[
        ["Date", "payment_date"], ["Payer", "payerName"], ["Source", "payment_source"], ["Method", "payment_method"], ["Amount", "amount_cents"], ["Trace", "trace_number"], ["Status", "payment_status"],
      ]} statusFields={["payment_status"]} moneyFields={["amount_cents"]} dateFields={["payment_date"]} />}
      {tab === "Denials" && <SimpleTable rows={data.denials} columns={[
        ["Date", "denial_date"], ["Payer", "payerName"], ["CARC", "carc_code"], ["RARC", "rarc_code"], ["Category", "denial_category"], ["Amount", "amount_cents"], ["Status", "denial_status"], ["Reason", "reason"],
      ]} statusFields={["denial_status"]} moneyFields={["amount_cents"]} dateFields={["denial_date"]} />}
      {tab === "Work Items" && <WorkItems rows={linkedWorkItems} />}
    </>
  );
}

function Overview({ data, encounterCount, workCount }: { data: ClientDetail; encounterCount: number; workCount: number }) {
  const totalOpen = data.claims.reduce(
    (sum, claim) => sum + Number(claim.openBalanceCents ?? claim.open_balance_cents ?? 0),
    0,
  );

  return (
    <div className="thera-detail-grid">
      <section className="thera-card">
        <h2>Client Summary</h2>
        <div className="thera-definition-grid">
          <Field name="Registration" value={<StatusBadge value={textValue(data.client, "registration_status")} />} />
          <Field name="Billing Readiness" value={<StatusBadge value={textValue(data.client, "billing_readiness_status")} />} />
          <Field name="Open A/R" value={money(totalOpen)} />
          <Field name="Open Work" value={workCount} />
        </div>
      </section>
      <section className="thera-card">
        <h2>Revenue-Cycle Spine</h2>
        <div className="thera-definition-grid">
          <Field name="Appointments" value={data.appointments.length} />
          <Field name="Encounters" value={encounterCount} />
          <Field name="Charges" value={data.charges.length} />
          <Field name="Claims" value={data.claims.length} />
        </div>
      </section>
    </div>
  );
}

function Encounters({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Empty message="No encounters are linked to this client." />;
  return (
    <section className="thera-card">
      <div className="thera-table-wrap">
        <table className="thera-table">
          <thead><tr><th>Started</th><th>Provider</th><th>Payer</th><th>Encounter</th><th>Billing</th><th>Charges</th><th>Claims</th><th>Latest Claim</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><Link className="thera-table-link" href={`/encounters/${row.id}`}>{dateTime(String(row.started_at ?? ""))}</Link></td>
                <td>{row.providerName ?? "—"}</td>
                <td>{row.payerName ?? "—"}</td>
                <td><StatusBadge value={String(row.encounter_status ?? "in_progress")} /></td>
                <td><StatusBadge value={String(row.billing_status ?? "not_ready")} /></td>
                <td>{row.chargeCount ?? 0}</td>
                <td>{row.claimCount ?? 0}</td>
                <td>{row.latestClaimStatus ? <StatusBadge value={String(row.latestClaimStatus)} /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Appointments({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Empty message="No appointments are linked to this client." />;
  return (
    <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table">
      <thead><tr><th>Date / Time</th><th>Provider</th><th>Service</th><th>CPT</th><th>Location</th><th>Status</th><th>Open</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}><td>{dateTime(String(row.starts_at ?? ""))}</td><td>{row.providerName ?? "—"}</td><td>{row.service_type ?? "—"}</td><td>{row.cpt_code ?? "—"}</td><td>{row.location_type ?? "—"}</td><td><StatusBadge value={String(row.appointment_status ?? "scheduled")} /></td><td><Link className="thera-link" href={`/schedule/${row.id}`}>Pre-Session</Link></td></tr>)}</tbody>
    </table></div></section>
  );
}

function ClinicalNotes({ rows }: { rows: Row[] }) {
  return <SimpleTable rows={rows} columns={[
    ["Service Date", "service_date"], ["Provider", "providerName"], ["Type", "note_type"], ["CPT", "cpt_code"], ["Diagnosis", "diagnosis_code"], ["Status", "note_status"], ["Signed", "signedAt"],
  ]} statusFields={["note_status"]} dateFields={["service_date"]} dateTimeFields={["signedAt"]} />;
}

function Claims({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Empty message="No claims are linked to this client." />;
  return (
    <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table">
      <thead><tr><th>Claim</th><th>DOS</th><th>Payer</th><th>Status</th><th>Charge</th><th>Paid</th><th>Balance</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}><td><Link href={`/claims/${row.id}`} className="thera-table-link">{row.patient_control_number || row.id}</Link></td><td>{shortDate(String(row.service_date_from ?? ""))}</td><td>{row.payerName || "—"}</td><td><StatusBadge value={String(row.claim_status ?? "")} /></td><td>{money(Number(row.total_charge_cents ?? 0))}</td><td>{money(Number(row.paidAmountCents ?? 0))}</td><td>{money(Number(row.openBalanceCents ?? row.total_charge_cents ?? 0))}</td></tr>)}</tbody>
    </table></div></section>
  );
}

function WorkItems({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Empty message="No active operational work is linked to this client." />;
  return (
    <section className="thera-card">
      <div className="thera-card-header"><div><h2>Linked Work</h2><p>Includes patient, appointment, encounter, charge and claim exceptions.</p></div><Link href="/work-center" className="thera-link">Open Work Center</Link></div>
      <div className="thera-table-wrap"><table className="thera-table">
        <thead><tr><th>Priority</th><th>Type</th><th>Title</th><th>Source</th><th>Status</th><th>Due</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}><td><StatusBadge value={String(row.priority ?? "normal")} /></td><td>{String(row.workqueue_type ?? "").replaceAll("_", " ")}</td><td>{row.title ?? "—"}<div className="thera-table-subtext">{row.description ?? ""}</div></td><td>{String(row.source_object_type ?? "—").replaceAll("_", " ")}</td><td><StatusBadge value={String(row.workqueue_status ?? "open")} /></td><td>{shortDate(String(row.due_date ?? ""))}</td></tr>)}</tbody>
      </table></div>
    </section>
  );
}

function SimpleTable({ rows, columns, statusFields = [], moneyFields = [], dateFields = [], dateTimeFields = [] }: {
  rows: Row[];
  columns: Array<[string, string]>;
  statusFields?: string[];
  moneyFields?: string[];
  dateFields?: string[];
  dateTimeFields?: string[];
}) {
  if (!rows.length) return <Empty message="No records in this section." />;
  return (
    <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table">
      <thead><tr>{columns.map(([label]) => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}>{columns.map(([label, field]) => {
        const raw = row[field];
        let value: any = raw ?? "—";
        if (statusFields.includes(field)) value = <StatusBadge value={String(raw ?? "unknown")} />;
        else if (moneyFields.includes(field)) value = money(Number(raw ?? 0));
        else if (dateFields.includes(field)) value = shortDate(String(raw ?? ""));
        else if (dateTimeFields.includes(field)) value = dateTime(String(raw ?? ""));
        return <td key={`${row.id}-${label}`}>{value}</td>;
      })}</tr>)}</tbody>
    </table></div></section>
  );
}

function Field({ name, value }: { name: string; value: any }) {
  return <div><div className="thera-field-label">{name}</div><div>{value}</div></div>;
}

function Empty({ message }: { message: string }) {
  return <section className="thera-card"><div className="thera-empty">{message}</div></section>;
}
