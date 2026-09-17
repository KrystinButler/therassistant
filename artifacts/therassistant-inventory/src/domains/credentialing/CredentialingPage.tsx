import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { WorkDrawer } from "../../components/work-drawer";
import { StatusBadge } from "../../components/status-badge";
import {
  getCurrentTenantId,
  referenceSelect,
  tenantRpc,
  tenantSelect,
  tenantUpdate,
} from "../../lib/tenant-data-client";
import { shortDate } from "../../lib/format";
import {
  availableEnrollmentActions,
  revalidationState,
  type EnrollmentStatus,
} from "./workflow";

type Row = Record<string, any>;
type EditForm = {
  id: string;
  effective_date: string;
  revalidation_due_date: string;
  termination_date: string;
  payer_provider_id: string;
  notes: string;
};

function fullName(row?: Row | null) {
  return row
    ? [row.first_name, row.last_name].filter(Boolean).join(" ")
    : "—";
}

function byId(rows: Row[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

async function syncRevalidationWork() {
  const tenantId = await getCurrentTenantId();
  await tenantRpc<number>("sync_provider_revalidation_work", {
    p_tenant_id: tenantId,
  });
}

export function CredentialingPage() {
  const [, navigate] = useLocation();
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<Row[]>([]);
  const [providers, setProviders] = useState<Row[]>([]);
  const [payers, setPayers] = useState<Row[]>([]);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [baseline, setBaseline] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void syncRevalidationWork().catch(() => null);

    Promise.all([
      tenantSelect("provider_payer_enrollments"),
      tenantSelect("providers"),
      referenceSelect("payers"),
    ])
      .then(([enrollmentRows, providerRows, payerRows]) => {
        if (!active) return;
        setEnrollments(enrollmentRows);
        setProviders(providerRows);
        setPayers(payerRows);
      })
      .catch((err: unknown) => {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load credentialing data",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [version]);

  const providerMap = useMemo(() => byId(providers), [providers]);
  const payerMap = useMemo(() => byId(payers), [payers]);
  const dirty = useMemo(
    () =>
      Boolean(
        editForm &&
          baseline &&
          JSON.stringify(editForm) !== JSON.stringify(baseline),
      ),
    [editForm, baseline],
  );
  const editingEnrollment = editForm
    ? enrollments.find((row) => row.id === editForm.id)
    : null;

  function openEdit(enrollment: Row) {
    const next = {
      id: enrollment.id,
      effective_date: enrollment.effective_date || "",
      revalidation_due_date: enrollment.revalidation_due_date || "",
      termination_date: enrollment.termination_date || "",
      payer_provider_id: enrollment.payer_provider_id || "",
      notes: enrollment.notes || "",
    };
    setEditForm(next);
    setBaseline({ ...next });
  }

  function closeEdit() {
    setEditForm(null);
    setBaseline(null);
  }

  async function transition(
    enrollment: Row,
    nextStatus: EnrollmentStatus,
    label: string,
  ) {
    setError(null);
    try {
      const tenantId = await getCurrentTenantId();
      await tenantRpc<string>("transition_provider_enrollment", {
        p_tenant_id: tenantId,
        p_enrollment_id: enrollment.id,
        p_enrollment_status: nextStatus,
        p_reason: label,
      });
      setVersion((value) => value + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update enrollment",
      );
    }
  }

  async function saveEdit() {
    if (!editForm) return;
    setSaving(true);
    setError(null);
    try {
      await tenantUpdate("provider_payer_enrollments", editForm.id, {
        effective_date: editForm.effective_date || null,
        revalidation_due_date: editForm.revalidation_due_date || null,
        termination_date: editForm.termination_date || null,
        payer_provider_id: editForm.payer_provider_id || null,
        notes: editForm.notes || null,
      });
      await syncRevalidationWork();
      closeEdit();
      setVersion((value) => value + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save enrollment",
      );
    } finally {
      setSaving(false);
    }
  }

  const actionRequired = enrollments.filter((enrollment) => {
    const state = revalidationState({
      enrollment_status: enrollment.enrollment_status,
      revalidation_due_date: enrollment.revalidation_due_date,
    });
    return (
      state === "due_soon" ||
      state === "overdue" ||
      enrollment.enrollment_status === "needs_revalidation"
    );
  }).length;

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">PAYER OPERATIONS</div>
          <h1>Credentialing</h1>
          <p>
            Provider-payer enrollment, participation, identifiers and
            revalidation work.
          </p>
        </div>
        <div className="thera-filter-row">
          <Link className="thera-action secondary" href="/providers">
            Providers
          </Link>
          <Link className="thera-action" href="/payers-contracts">
            Payers &amp; Contracts
          </Link>
        </div>
      </div>

      <div className="thera-metric-grid">
        <div className="thera-metric-card">
          <div className="thera-metric-label">Enrollments</div>
          <div className="thera-metric-value">{enrollments.length}</div>
        </div>
        <div className="thera-metric-card">
          <div className="thera-metric-label">Approved</div>
          <div className="thera-metric-value">
            {
              enrollments.filter(
                (row) => row.enrollment_status === "approved",
              ).length
            }
          </div>
        </div>
        <div className="thera-metric-card">
          <div className="thera-metric-label">Submitted</div>
          <div className="thera-metric-value">
            {
              enrollments.filter(
                (row) => row.enrollment_status === "submitted",
              ).length
            }
          </div>
        </div>
        <div className="thera-metric-card">
          <div className="thera-metric-label">Revalidation Action</div>
          <div className="thera-metric-value">{actionRequired}</div>
        </div>
      </div>

      {error && <div className="thera-state error">{error}</div>}

      <section className="thera-card">
        {loading && (
          <div className="thera-state">Loading credentialing...</div>
        )}
        {!loading && (
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Payer</th>
                  <th>Status</th>
                  <th>Effective</th>
                  <th>Revalidation</th>
                  <th>Due State</th>
                  <th>Payer Provider ID</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((enrollment) => {
                  const dueState = revalidationState({
                    enrollment_status: enrollment.enrollment_status,
                    revalidation_due_date: enrollment.revalidation_due_date,
                  });
                  return (
                    <tr key={enrollment.id}>
                      <td>
                        <Link
                          className="thera-table-link"
                          href={`/providers/${enrollment.provider_id}`}
                        >
                          {fullName(providerMap.get(enrollment.provider_id))}
                        </Link>
                      </td>
                      <td>
                        <Link
                          className="thera-table-link"
                          href={`/payers/${enrollment.payer_id}`}
                        >
                          {payerMap.get(enrollment.payer_id)?.name || "—"}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge value={enrollment.enrollment_status} />
                      </td>
                      <td>{shortDate(enrollment.effective_date)}</td>
                      <td>{shortDate(enrollment.revalidation_due_date)}</td>
                      <td>
                        <StatusBadge value={dueState} />
                      </td>
                      <td>{enrollment.payer_provider_id || "—"}</td>
                      <td>{enrollment.notes || "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="thera-action secondary"
                          onClick={() => openEdit(enrollment)}
                        >
                          Edit Enrollment
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editForm && editingEnrollment && (
        <WorkDrawer
          open={Boolean(editForm)}
          onOpenChange={(open) => {
            if (!open) closeEdit();
          }}
          dirty={dirty}
          title="Edit Enrollment"
          subtitle={`${fullName(
            providerMap.get(editingEnrollment.provider_id),
          )} · ${payerMap.get(editingEnrollment.payer_id)?.name || "Payer"}`}
          badges={<StatusBadge value={editingEnrollment.enrollment_status} />}
          openFullRecord={() =>
            navigate(`/providers/${editingEnrollment.provider_id}`)
          }
          openFullRecordLabel="Open Provider Detail"
          footer={
            <div
              className="thera-filter-row"
              style={{ justifyContent: "space-between" }}
            >
              <button
                type="button"
                className="thera-action secondary"
                onClick={closeEdit}
              >
                Cancel
              </button>
              <button
                type="button"
                className="thera-action"
                disabled={saving}
                onClick={() => void saveEdit()}
              >
                {saving ? "Saving..." : "Save Enrollment"}
              </button>
            </div>
          }
        >
          <div className="thera-form-grid">
            <label>
              Effective Date
              <input
                className="thera-input"
                type="date"
                value={editForm.effective_date}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    effective_date: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Revalidation Due
              <input
                className="thera-input"
                type="date"
                value={editForm.revalidation_due_date}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    revalidation_due_date: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Termination Date
              <input
                className="thera-input"
                type="date"
                value={editForm.termination_date}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    termination_date: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Payer Provider ID
              <input
                className="thera-input"
                value={editForm.payer_provider_id}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    payer_provider_id: event.target.value,
                  })
                }
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Notes
              <textarea
                className="thera-input"
                rows={5}
                value={editForm.notes}
                onChange={(event) =>
                  setEditForm({ ...editForm, notes: event.target.value })
                }
              />
            </label>
          </div>

          <section className="thera-card">
            <h2>Enrollment workflow</h2>
            <p>
              Advance the payer enrollment record without leaving the
              credentialing workspace.
            </p>
            <div className="thera-filter-row">
              {availableEnrollmentActions(
                editingEnrollment.enrollment_status as EnrollmentStatus,
              ).map((action) => (
                <button
                  type="button"
                  className="thera-action secondary"
                  key={action.nextStatus}
                  disabled={saving}
                  onClick={() =>
                    void transition(
                      editingEnrollment,
                      action.nextStatus,
                      action.label,
                    )
                  }
                >
                  {action.label}
                </button>
              ))}
            </div>
          </section>
        </WorkDrawer>
      )}
    </>
  );
}
