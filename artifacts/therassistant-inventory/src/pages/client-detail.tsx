import { useState } from "react";
import { Link, useRoute } from "wouter";
import { StatusBadge } from "../components/status-badge";
import {
  dateTime,
  money,
  shortDate,
  textValue,
} from "../lib/format";
import { useApi } from "../lib/therassistant-api";

type ClientDetail = {
  client: Record<string, any>;
  insurancePolicies: Array<Record<string, any>>;
  appointments: Array<Record<string, any>>;
  treatmentPlans: Array<Record<string, any>>;
  clinicalNotes: Array<Record<string, any>>;
  charges: Array<Record<string, any>>;
  claims: Array<Record<string, any>>;
  payments: Array<Record<string, any>>;
  denials: Array<Record<string, any>>;
  workItems: Array<Record<string, any>>;
};

const tabs = [
  "Overview",
  "Insurance",
  "Appointments",
  "Treatment Plans",
  "Clinical Notes",
  "Charges",
  "Claims",
  "Payments",
  "Denials",
  "Work Items",
] as const;

export function ClientDetailPage() {
  const [, params] = useRoute<{
    id: string;
  }>("/clients/:id");

  const [tab, setTab] =
    useState<(typeof tabs)[number]>("Overview");

  const { data, loading, error } =
    useApi<ClientDetail>(
      `/api/clients/${params?.id ?? ""}`,
    );

  if (loading) {
    return (
      <div className="thera-state">
        Loading client...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="thera-state error">
        {error || "Client not found"}
      </div>
    );
  }

  const client = data.client;

  return (
    <>
      <div className="thera-breadcrumb">
        <Link
          href="/clients"
          className="thera-link"
        >
          Clients
        </Link>
        <span>/</span>
        <span>
          {textValue(client, "first_name")}{" "}
          {textValue(client, "last_name")}
        </span>
      </div>

      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">
            CLIENT 360
          </div>

          <h1>
            {textValue(client, "preferred_name") !==
            "—"
              ? textValue(
                  client,
                  "preferred_name",
                )
              : textValue(
                  client,
                  "first_name",
                )}{" "}
            {textValue(client, "last_name")}
          </h1>

          <p>
            DOB{" "}
            {shortDate(
              textValue(
                client,
                "date_of_birth",
              ),
            )}{" "}
            · {textValue(client, "email")} ·{" "}
            {textValue(client, "phone")}
          </p>
        </div>

        <div className="thera-header-badges">
          <StatusBadge
            value={textValue(
              client,
              "client_status",
            )}
          />

          <StatusBadge
            value={textValue(
              client,
              "billing_readiness_status",
            )}
          />
        </div>
      </div>

      <div className="thera-tabs">
        {tabs.map((name) => (
          <button
            type="button"
            key={name}
            className={
              tab === name
                ? "thera-tab active"
                : "thera-tab"
            }
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <Overview data={data} />
      )}

      {tab === "Insurance" && (
        <Insurance rows={data.insurancePolicies} />
      )}

      {tab === "Appointments" && (
        <Appointments rows={data.appointments} />
      )}

      {tab === "Treatment Plans" && (
        <TreatmentPlans
          rows={data.treatmentPlans}
        />
      )}

      {tab === "Clinical Notes" && (
        <ClinicalNotes rows={data.clinicalNotes} />
      )}

      {tab === "Charges" && (
        <Charges rows={data.charges} />
      )}

      {tab === "Claims" && (
        <Claims rows={data.claims} />
      )}

      {tab === "Payments" && (
        <Payments rows={data.payments} />
      )}

      {tab === "Denials" && (
        <Denials rows={data.denials} />
      )}

      {tab === "Work Items" && (
        <WorkItems rows={data.workItems} />
      )}
    </>
  );
}

function Overview({
  data,
}: {
  data: ClientDetail;
}) {
  const client = data.client;

  const totalOpen = data.claims.reduce(
    (sum, claim) =>
      sum +
      Number(
        claim.openBalanceCents ??
          claim.open_balance_cents ??
          0,
      ),
    0,
  );

  return (
    <div className="thera-detail-grid">
      <section className="thera-card">
        <h2>Client Summary</h2>

        <div className="thera-definition-grid">
          <Field
            name="Registration"
            value={
              <StatusBadge
                value={textValue(
                  client,
                  "registration_status",
                )}
              />
            }
          />

          <Field
            name="Billing Readiness"
            value={
              <StatusBadge
                value={textValue(
                  client,
                  "billing_readiness_status",
                )}
              />
            }
          />

          <Field
            name="City"
            value={`${textValue(
              client,
              "city",
            )}, ${textValue(client, "state")}`}
          />

          <Field
            name="Open A/R"
            value={money(totalOpen)}
          />
        </div>
      </section>

      <section className="thera-card">
        <h2>Operational Snapshot</h2>

        <div className="thera-definition-grid">
          <Field
            name="Insurance Policies"
            value={data.insurancePolicies.length}
          />

          <Field
            name="Appointments"
            value={data.appointments.length}
          />

          <Field
            name="Claims"
            value={data.claims.length}
          />

          <Field
            name="Open Work"
            value={data.workItems.length}
          />
        </div>
      </section>

      <section className="thera-card thera-span-2">
        <h2>Active Alerts</h2>

        {data.workItems.length === 0 ? (
          <div className="thera-empty">
            No active operational alerts.
          </div>
        ) : (
          <div className="thera-stack">
            {data.workItems.map((item) => (
              <div
                className="thera-work-card"
                key={item.id}
              >
                <div className="thera-work-card-top">
                  <StatusBadge
                    value={item.priority}
                  />

                  <StatusBadge
                    value={
                      item.workqueue_status ??
                      item.workqueueStatus
                    }
                  />
                </div>

                <strong>{item.title}</strong>

                <div className="thera-muted">
                  {item.description}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Insurance({
  rows,
}: {
  rows: Array<Record<string, any>>;
}) {
  return (
    <SimpleTable
      columns={[
        ["Payer", "payerName"],
        ["Plan", "planName"],
        ["Member ID", "member_id"],
        ["Order", "insurance_order"],
        ["Effective", "effective_date"],
        ["Termination", "termination_date"],
        ["Status", "status"],
      ]}
      rows={rows}
      statusFields={["status"]}
      dateFields={[
        "effective_date",
        "termination_date",
      ]}
    />
  );
}

function Appointments({
  rows,
}: {
  rows: Array<Record<string, any>>;
}) {
  return (
    <SimpleTable
      columns={[
        ["Date / Time", "starts_at"],
        ["Provider", "providerName"],
        ["Service", "service_type"],
        ["CPT", "cpt_code"],
        ["Location", "location_type"],
        ["Status", "appointment_status"],
      ]}
      rows={rows}
      statusFields={["appointment_status"]}
      dateTimeFields={["starts_at"]}
    />
  );
}

function TreatmentPlans({
  rows,
}: {
  rows: Array<Record<string, any>>;
}) {
  return (
    <SimpleTable
      columns={[
        ["Provider", "providerName"],
        ["Effective", "effective_date"],
        ["Review Due", "review_due_date"],
        ["Status", "status"],
        ["Plan", "plan_text"],
      ]}
      rows={rows}
      statusFields={["status"]}
      dateFields={[
        "effective_date",
        "review_due_date",
      ]}
    />
  );
}

function ClinicalNotes({
  rows,
}: {
  rows: Array<Record<string, any>>;
}) {
  return (
    <SimpleTable
      columns={[
        ["Service Date", "service_date"],
        ["Provider", "providerName"],
        ["Type", "note_type"],
        ["CPT", "cpt_code"],
        ["Diagnosis", "diagnosis_code"],
        ["Status", "note_status"],
        ["Signed", "signedAt"],
      ]}
      rows={rows}
      statusFields={["note_status"]}
      dateFields={["service_date"]}
      dateTimeFields={["signedAt"]}
    />
  );
}

function Charges({
  rows,
}: {
  rows: Array<Record<string, any>>;
}) {
  return (
    <SimpleTable
      columns={[
        ["Service Date", "service_date"],
        ["Provider", "providerName"],
        ["Payer", "payerName"],
        ["CPT", "cpt_code"],
        ["Charge", "charge_amount_cents"],
        ["Status", "charge_status"],
        ["Block Reason", "block_reason"],
      ]}
      rows={rows}
      statusFields={["charge_status"]}
      moneyFields={["charge_amount_cents"]}
      dateFields={["service_date"]}
    />
  );
}

function Claims({
  rows,
}: {
  rows: Array<Record<string, any>>;
}) {
  return (
    <section className="thera-card">
      <div className="thera-table-wrap">
        <table className="thera-table">
          <thead>
            <tr>
              <th>Claim</th>
              <th>DOS</th>
              <th>Payer</th>
              <th>Status</th>
              <th>Charge</th>
              <th>Paid</th>
              <th>Balance</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link
                    href={`/claims/${row.id}`}
                    className="thera-table-link"
                  >
                    {row.patient_control_number ||
                      row.id}
                  </Link>
                </td>

                <td>
                  {shortDate(
                    row.service_date_from,
                  )}
                </td>

                <td>{row.payerName || "—"}</td>

                <td>
                  <StatusBadge
                    value={row.claim_status}
                  />
                </td>

                <td>
                  {money(
                    row.total_charge_cents,
                  )}
                </td>

                <td>
                  {money(
                    row.paidAmountCents,
                  )}
                </td>

                <td>
                  {money(
                    row.openBalanceCents,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Payments({
  rows,
}: {
  rows: Array<Record<string, any>>;
}) {
  return (
    <SimpleTable
      columns={[
        ["Date", "payment_date"],
        ["Payer", "payerName"],
        ["Source", "payment_source"],
        ["Method", "payment_method"],
        ["Amount", "amount_cents"],
        ["Trace", "trace_number"],
        ["Status", "payment_status"],
      ]}
      rows={rows}
      statusFields={["payment_status"]}
      moneyFields={["amount_cents"]}
      dateFields={["payment_date"]}
    />
  );
}

function Denials({
  rows,
}: {
  rows: Array<Record<string, any>>;
}) {
  return (
    <SimpleTable
      columns={[
        ["Date", "denial_date"],
        ["Payer", "payerName"],
        ["CARC", "carc_code"],
        ["RARC", "rarc_code"],
        ["Category", "denial_category"],
        ["Amount", "amount_cents"],
        ["Status", "denial_status"],
        ["Reason", "reason"],
      ]}
      rows={rows}
      statusFields={["denial_status"]}
      moneyFields={["amount_cents"]}
      dateFields={["denial_date"]}
    />
  );
}

function WorkItems({
  rows,
}: {
  rows: Array<Record<string, any>>;
}) {
  return (
    <SimpleTable
      columns={[
        ["Priority", "priority"],
        ["Type", "workqueue_type"],
        ["Title", "title"],
        ["Status", "workqueue_status"],
        ["Due", "due_date"],
        ["Description", "description"],
      ]}
      rows={rows}
      statusFields={[
        "priority",
        "workqueue_status",
      ]}
      dateFields={["due_date"]}
    />
  );
}

function SimpleTable({
  columns,
  rows,
  statusFields = [],
  moneyFields = [],
  dateFields = [],
  dateTimeFields = [],
}: {
  columns: Array<[string, string]>;
  rows: Array<Record<string, any>>;
  statusFields?: string[];
  moneyFields?: string[];
  dateFields?: string[];
  dateTimeFields?: string[];
}) {
  return (
    <section className="thera-card">
      {rows.length === 0 ? (
        <div className="thera-empty">
          No records in this section.
        </div>
      ) : (
        <div className="thera-table-wrap">
          <table className="thera-table">
            <thead>
              <tr>
                {columns.map(([title]) => (
                  <th key={title}>{title}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id ?? index}>
                  {columns.map(
                    ([title, property]) => {
                      const result =
                        row[property] ?? null;

                      let display:
                        | string
                        | number
                        | JSX.Element = "—";

                      if (
                        statusFields.includes(
                          property,
                        )
                      ) {
                        display = (
                          <StatusBadge
                            value={
                              result == null
                                ? null
                                : String(result)
                            }
                          />
                        );
                      } else if (
                        moneyFields.includes(
                          property,
                        )
                      ) {
                        display = money(result);
                      } else if (
                        dateTimeFields.includes(
                          property,
                        )
                      ) {
                        display = dateTime(result);
                      } else if (
                        dateFields.includes(property)
                      ) {
                        display = shortDate(result);
                      } else if (
                        result !== null &&
                        result !== undefined &&
                        result !== ""
                      ) {
                        display = String(result);
                      }

                      return (
                        <td key={title}>
                          {display}
                        </td>
                      );
                    },
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Field({
  name,
  value,
}: {
  name: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="thera-field-label">
        {name}
      </div>
      <div className="thera-field-value">
        {value}
      </div>
    </div>
  );
}
