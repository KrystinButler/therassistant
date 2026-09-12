import { Link, useRoute } from "wouter";
import { StatusBadge } from "../components/status-badge";
import {
  dateTime,
  money,
  shortDate,
} from "../lib/format";
import { useApi } from "../lib/therassistant-api";

type ClaimDetail = {
  claim: Record<string, any>;
  charge: Record<string, any> | null;
  lines: Array<Record<string, any>>;
  diagnoses: Array<Record<string, any>>;
  statusHistory: Array<Record<string, any>>;
  notes: Array<Record<string, any>>;
  payments: Array<Record<string, any>>;
  balance: Record<string, any> | null;
  denials: Array<Record<string, any>>;
  appeals: Array<Record<string, any>>;
  workItems: Array<Record<string, any>>;
};

export function ClaimDetailPage() {
  const [, params] = useRoute<{
    id: string;
  }>("/claims/:id");

  const { data, loading, error } =
    useApi<ClaimDetail>(
      `/api/claims/${params?.id ?? ""}`,
    );

  if (loading) {
    return (
      <div className="thera-state">
        Loading claim...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="thera-state error">
        {error || "Claim not found"}
      </div>
    );
  }

  const claim = data.claim;
  const balance = data.balance;

  return (
    <>
      <div className="thera-breadcrumb">
        <Link
          href="/claims"
          className="thera-link"
        >
          Claims
        </Link>

        <span>/</span>

        <span>
          {claim.patient_control_number ||
            "Claim Detail"}
        </span>
      </div>

      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">
            CLAIM 360
          </div>

          <h1>
            {claim.clientName}
          </h1>

          <p>
            {claim.payerName || "No payer"} · DOS{" "}
            {shortDate(
              claim.service_date_from,
            )}{" "}
            ·{" "}
            {claim.patient_control_number ||
              "No control number"}
          </p>
        </div>

        <StatusBadge
          value={claim.claim_status}
        />
      </div>

      <div className="thera-metric-grid four">
        <Metric
          name="Charge"
          value={money(
            balance?.total_charge_cents ??
              claim.total_charge_cents,
          )}
        />

        <Metric
          name="Paid"
          value={money(
            balance?.paid_amount_cents,
          )}
        />

        <Metric
          name="Adjustments"
          value={money(
            balance?.adjustment_amount_cents,
          )}
        />

        <Metric
          name="Open Balance"
          value={money(
            balance?.open_balance_cents ??
              claim.total_charge_cents,
          )}
        />
      </div>

      <div className="thera-detail-grid">
        <section className="thera-card">
          <h2>Claim Information</h2>

          <div className="thera-definition-grid">
            <Field
              name="Payer Claim #"
              value={
                claim.payer_claim_number || "—"
              }
            />

            <Field
              name="Clearinghouse ID"
              value={
                claim.clearinghouse_claim_id ||
                "—"
              }
            />

            <Field
              name="Rendering Provider"
              value={`${claim.renderingProviderName || "—"} ${claim.renderingProviderCredentials || ""}`}
            />

            <Field
              name="Billing Provider"
              value={`${claim.billingProviderName || "—"} ${claim.billingProviderCredentials || ""}`}
            />

            <Field
              name="Submitted"
              value={dateTime(
                claim.submitted_at,
              )}
            />

            <Field
              name="Accepted"
              value={dateTime(
                claim.accepted_at,
              )}
            />
          </div>
        </section>

        <section className="thera-card">
          <h2>Billing Readiness</h2>

          {data.charge ? (
            <>
              <div className="thera-definition-grid">
                <Field
                  name="Charge Status"
                  value={
                    <StatusBadge
                      value={
                        data.charge
                          .charge_status
                      }
                    />
                  }
                />

                <Field
                  name="CPT"
                  value={
                    data.charge.cpt_code ||
                    "—"
                  }
                />

                <Field
                  name="Diagnosis"
                  value={
                    data.charge
                      .diagnosis_code || "—"
                  }
                />

                <Field
                  name="Place of Service"
                  value={
                    data.charge
                      .place_of_service || "—"
                  }
                />
              </div>

              {data.charge.block_reason && (
                <div className="thera-alert danger">
                  <strong>Submission Block</strong>
                  <div>
                    {data.charge.block_reason}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="thera-empty">
              No linked charge.
            </div>
          )}
        </section>

        <section className="thera-card thera-span-2">
          <h2>Claim Lines</h2>

          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>DOS</th>
                  <th>CPT</th>
                  <th>Units</th>
                  <th>Charge</th>
                  <th>Allowed</th>
                  <th>Paid</th>
                  <th>Adjustment</th>
                </tr>
              </thead>

              <tbody>
                {data.lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      {shortDate(
                        line.service_date,
                      )}
                    </td>
                    <td>{line.cpt_code}</td>
                    <td>{line.units}</td>
                    <td>
                      {money(
                        line.charge_amount_cents,
                      )}
                    </td>
                    <td>
                      {money(
                        line.allowed_amount_cents,
                      )}
                    </td>
                    <td>
                      {money(
                        line.paid_amount_cents,
                      )}
                    </td>
                    <td>
                      {money(
                        line.adjustment_amount_cents,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {data.denials.length > 0 && (
          <section className="thera-card thera-span-2">
            <div className="thera-card-header">
              <div>
                <h2>Denial Intelligence</h2>
                <p>
                  Payer response routed directly into
                  operational follow-up.
                </p>
              </div>
            </div>

            {data.denials.map((denial) => (
              <div
                className="thera-denial-panel"
                key={denial.id}
              >
                <div>
                  <div className="thera-eyebrow">
                    CARC {denial.carc_code || "—"} ·
                    RARC {denial.rarc_code || "—"}
                  </div>

                  <h3>
                    {denial.denial_category ||
                      "Denial"}
                  </h3>

                  <p>{denial.reason}</p>
                </div>

                <div>
                  <StatusBadge
                    value={
                      denial.denial_status
                    }
                  />
                  <div className="thera-denial-amount">
                    {money(
                      denial.amount_cents,
                    )}
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        {data.appeals.length > 0 && (
          <section className="thera-card">
            <h2>Appeals</h2>

            {data.appeals.map((appeal) => (
              <div
                className="thera-stack-item"
                key={appeal.id}
              >
                <div className="thera-row-between">
                  <strong>
                    {appeal.appeal_level?.replaceAll(
                      "_",
                      " ",
                    )}
                  </strong>

                  <StatusBadge
                    value={
                      appeal.appeal_status
                    }
                  />
                </div>

                <div className="thera-muted">
                  Deadline{" "}
                  {shortDate(
                    appeal.deadline_date,
                  )}
                </div>

                <p>{appeal.notes}</p>
              </div>
            ))}
          </section>
        )}

        {data.payments.length > 0 && (
          <section className="thera-card">
            <h2>Payments</h2>

            {data.payments.map((payment) => (
              <div
                className="thera-stack-item"
                key={
                  payment.allocationId ??
                  payment.id
                }
              >
                <div className="thera-row-between">
                  <strong>
                    {money(
                      payment
                        .allocatedAmountCents,
                    )}
                  </strong>

                  <StatusBadge
                    value={
                      payment.payment_status
                    }
                  />
                </div>

                <div className="thera-muted">
                  {shortDate(
                    payment.payment_date,
                  )}{" "}
                  ·{" "}
                  {payment.trace_number ||
                    "No trace number"}
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="thera-card">
          <h2>Status History</h2>

          {data.statusHistory.map(
            (history) => (
              <div
                className="thera-timeline-item"
                key={history.id}
              >
                <div>
                  <StatusBadge
                    value={
                      history.new_status
                    }
                  />
                </div>

                <div>
                  <strong>
                    {history.reason ||
                      "Claim status updated"}
                  </strong>

                  <div className="thera-muted">
                    {dateTime(
                      history.created_at,
                    )}
                  </div>
                </div>
              </div>
            ),
          )}
        </section>

        <section className="thera-card">
          <h2>Work Center</h2>

          {data.workItems.length === 0 ? (
            <div className="thera-empty">
              No active work items.
            </div>
          ) : (
            data.workItems.map((item) => (
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
                      item.workqueue_status
                    }
                  />
                </div>

                <strong>{item.title}</strong>

                <div className="thera-muted">
                  {item.description}
                </div>
              </div>
            ))
          )}
        </section>

        <section className="thera-card">
          <h2>Claim Notes</h2>

          {data.notes.length === 0 ? (
            <div className="thera-empty">
              No claim notes.
            </div>
          ) : (
            data.notes.map((note) => (
              <div
                className="thera-stack-item"
                key={note.id}
              >
                <div className="thera-muted">
                  {dateTime(note.created_at)}
                </div>
                <p>{note.note_text}</p>
              </div>
            ))
          )}
        </section>
      </div>
    </>
  );
}

function Metric({
  name,
  value,
}: {
  name: string;
  value: string;
}) {
  return (
    <div className="thera-metric-card">
      <div className="thera-metric-label">
        {name}
      </div>
      <div className="thera-metric-value">
        {value}
      </div>
    </div>
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
