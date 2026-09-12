import { useState } from "react";
import { Link } from "wouter";
import { StatusBadge } from "../components/status-badge";
import {
  money,
  shortDate,
} from "../lib/format";
import { useApi } from "../lib/therassistant-api";

type ClaimRow = {
  id: string;
  patientControlNumber?: string | null;
  payerClaimNumber?: string | null;
  claimStatus: string;
  serviceDateFrom?: string | null;
  totalChargeCents?: number;
  clientName: string;
  payerName?: string | null;
  renderingProviderName?: string | null;
  billingProviderName?: string | null;
  paidAmountCents?: number;
  adjustmentAmountCents?: number;
  openBalanceCents?: number;
  denialCount?: number;
};

export function ClaimsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const path =
    `/api/claims?search=${encodeURIComponent(
      search,
    )}&status=${encodeURIComponent(status)}`;

  const { data, loading, error } =
    useApi<ClaimRow[]>(path);

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">
            CLAIM OPERATIONS
          </div>

          <h1>Claims Workqueue</h1>

          <p>
            Submission readiness, payer status,
            financial balance, denials, and follow-up.
          </p>
        </div>

        <div className="thera-filter-row">
          <input
            className="thera-input"
            placeholder="Search claims..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />

          <select
            className="thera-input"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value)
            }
          >
            <option value="">
              All statuses
            </option>
            <option value="paid">Paid</option>
            <option value="denied">
              Denied
            </option>
            <option value="validation_failed">
              Validation Failed
            </option>
            <option value="paid_under_review">
              Paid — Review
            </option>
          </select>
        </div>
      </div>

      <section className="thera-card">
        {loading && (
          <div className="thera-state">
            Loading claims...
          </div>
        )}

        {error && (
          <div className="thera-state error">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>Claim</th>
                  <th>Client</th>
                  <th>DOS</th>
                  <th>Payer</th>
                  <th>Rendering Provider</th>
                  <th>Charge</th>
                  <th>Paid</th>
                  <th>Adjustment</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th>Denial</th>
                </tr>
              </thead>

              <tbody>
                {(data ?? []).map((claim) => (
                  <tr key={claim.id}>
                    <td>
                      <Link
                        href={`/claims/${claim.id}`}
                        className="thera-table-link"
                      >
                        {claim.patientControlNumber ||
                          "Open Claim"}
                      </Link>

                      <div className="thera-table-subtext">
                        {claim.payerClaimNumber ||
                          "No payer claim #"}
                      </div>
                    </td>

                    <td>{claim.clientName}</td>

                    <td>
                      {shortDate(
                        claim.serviceDateFrom,
                      )}
                    </td>

                    <td>
                      {claim.payerName || "—"}
                    </td>

                    <td>
                      {claim.renderingProviderName ||
                        "—"}
                    </td>

                    <td>
                      {money(
                        claim.totalChargeCents,
                      )}
                    </td>

                    <td>
                      {money(
                        claim.paidAmountCents,
                      )}
                    </td>

                    <td>
                      {money(
                        claim.adjustmentAmountCents,
                      )}
                    </td>

                    <td>
                      {money(
                        claim.openBalanceCents,
                      )}
                    </td>

                    <td>
                      <StatusBadge
                        value={claim.claimStatus}
                      />
                    </td>

                    <td>
                      {Number(
                        claim.denialCount ?? 0,
                      ) > 0 ? (
                        <StatusBadge value="denied" />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
