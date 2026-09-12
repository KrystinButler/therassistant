import { useState } from "react";
import { Link } from "wouter";
import { StatusBadge } from "../components/status-badge";
import {
  dateTime,
  money,
  shortDate,
} from "../lib/format";
import { useApi } from "../lib/therassistant-api";

type ClientRow = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  clientStatus: string;
  registrationStatus: string;
  billingReadinessStatus: string;
  payerName?: string | null;
  planName?: string | null;
  nextAppointment?: string | null;
  openBalanceCents?: number;
};

export function ClientsPage() {
  const [search, setSearch] = useState("");

  const { data, loading, error } =
    useApi<ClientRow[]>(
      `/api/clients?search=${encodeURIComponent(
        search,
      )}`,
    );

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">
            CLIENT OPERATIONS
          </div>

          <h1>Clients</h1>

          <p>
            Clinical, payer, authorization, claim,
            payment, and work history in one record.
          </p>
        </div>

        <div className="thera-search-wrap">
          <input
            className="thera-input"
            placeholder="Search clients..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />
        </div>
      </div>

      <section className="thera-card">
        {loading && (
          <div className="thera-state">
            Loading clients...
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
                  <th>Client</th>
                  <th>DOB</th>
                  <th>Insurance</th>
                  <th>Registration</th>
                  <th>Billing Readiness</th>
                  <th>Next Appointment</th>
                  <th>Open Balance</th>
                </tr>
              </thead>

              <tbody>
                {(data ?? []).map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link
                        href={`/clients/${client.id}`}
                        className="thera-table-link"
                      >
                        {client.firstName}{" "}
                        {client.lastName}
                      </Link>

                      <div className="thera-table-subtext">
                        <StatusBadge
                          value={client.clientStatus}
                        />
                      </div>
                    </td>

                    <td>
                      {shortDate(
                        client.dateOfBirth,
                      )}
                    </td>

                    <td>
                      <strong>
                        {client.payerName || "—"}
                      </strong>

                      <div className="thera-table-subtext">
                        {client.planName || ""}
                      </div>
                    </td>

                    <td>
                      <StatusBadge
                        value={
                          client.registrationStatus
                        }
                      />
                    </td>

                    <td>
                      <StatusBadge
                        value={
                          client.billingReadinessStatus
                        }
                      />
                    </td>

                    <td>
                      {client.nextAppointment
                        ? dateTime(
                            client.nextAppointment,
                          )
                        : "—"}
                    </td>

                    <td>
                      {money(
                        client.openBalanceCents,
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
