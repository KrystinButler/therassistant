import { Link } from "wouter";
import { StatusBadge } from "../components/status-badge";
import { shortDate } from "../lib/format";
import { useApi } from "../lib/therassistant-api";

type WorkItem = {
  id: string;
  workqueueType: string;
  workqueueStatus: string;
  priority: string;
  sourceObjectType?: string | null;
  sourceObjectId?: string | null;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  relatedName?: string | null;
  payerName?: string | null;
};

export function WorkCenterPage() {
  const { data, loading, error } =
    useApi<WorkItem[]>("/api/workqueues");

  return (
    <>
      <div className="thera-page-header">
        <div>
          <div className="thera-eyebrow">
            UNIFIED OPERATIONS
          </div>

          <h1>Work Center</h1>

          <p>
            One queue for clinical readiness,
            eligibility, claims, denials, payment
            exceptions, credentialing, authorizations,
            and other operational work.
          </p>
        </div>
      </div>

      <section className="thera-card">
        {loading && (
          <div className="thera-state">
            Loading Work Center...
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
                  <th>Priority</th>
                  <th>Type</th>
                  <th>Work Item</th>
                  <th>Related Record</th>
                  <th>Payer</th>
                  <th>Status</th>
                  <th>Due</th>
                </tr>
              </thead>

              <tbody>
                {(data ?? []).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <StatusBadge
                        value={item.priority}
                      />
                    </td>

                    <td>
                      {item.workqueueType.replaceAll(
                        "_",
                        " ",
                      )}
                    </td>

                    <td>
                      {item.sourceObjectType ===
                        "claim" &&
                      item.sourceObjectId ? (
                        <Link
                          href={`/claims/${item.sourceObjectId}`}
                          className="thera-table-link"
                        >
                          {item.title}
                        </Link>
                      ) : item.sourceObjectType ===
                          "client" &&
                        item.sourceObjectId ? (
                        <Link
                          href={`/clients/${item.sourceObjectId}`}
                          className="thera-table-link"
                        >
                          {item.title}
                        </Link>
                      ) : (
                        <strong>
                          {item.title}
                        </strong>
                      )}

                      <div className="thera-table-subtext">
                        {item.description || ""}
                      </div>
                    </td>

                    <td>
                      {item.relatedName || "—"}
                    </td>

                    <td>
                      {item.payerName || "—"}
                    </td>

                    <td>
                      <StatusBadge
                        value={
                          item.workqueueStatus
                        }
                      />
                    </td>

                    <td>
                      {shortDate(item.dueDate)}
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
