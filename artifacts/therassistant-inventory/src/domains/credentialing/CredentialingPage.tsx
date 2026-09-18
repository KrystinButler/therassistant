import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { WorkDrawer } from "../../components/work-drawer";
import { shortDate } from "../../lib/format";
import {
  getCurrentTenantId,
  tenantRpc,
  tenantSelect,
  tenantUpdate,
} from "../../lib/tenant-data-client";
import {
  availableEnrollmentActions,
  type EnrollmentStatus,
} from "./workflow";

type Row = Record<string, any>;
type WorkspaceTab = "work" | "applications" | "participation" | "expirations";
type DrawerTab = "overview" | "requirements" | "followup" | "history";

type EnrollmentEdit = {
  effective_date: string;
  revalidation_due_date: string;
  termination_date: string;
  payer_provider_id: string;
  notes: string;
};

const credentialingWorkTypes = new Set([
  "credentialing_issue",
  "credentialing_followup",
  "credential_expiration",
  "network_verification",
  "roster_action",
  "recredentialing",
]);

const terminalApplicationStatuses = new Set([
  "complete",
  "denied",
  "withdrawn",
  "terminated",
  "closed",
]);

const awaitingProviderStatuses = new Set(["intake", "missing_information"]);
const awaitingPayerStatuses = new Set(["submitted", "payer_review"]);
const payerRequestStatuses = new Set(["additional_information_requested"]);

function emptyEnrollmentEdit(): EnrollmentEdit {
  return {
    effective_date: "",
    revalidation_due_date: "",
    termination_date: "",
    payer_provider_id: "",
    notes: "",
  };
}

export function CredentialingPage() {
  const [, navigate] = useLocation();
  const [version, setVersion] = useState(0);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("work");
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cases, setCases] = useState<Row[]>([]);
  const [participation, setParticipation] = useState<Row[]>([]);
  const [expirations, setExpirations] = useState<Row[]>([]);
  const [workItems, setWorkItems] = useState<Row[]>([]);
  const [requirements, setRequirements] = useState<Row[]>([]);
  const [followups, setFollowups] = useState<Row[]>([]);
  const [statusHistory, setStatusHistory] = useState<Row[]>([]);
  const [enrollments, setEnrollments] = useState<Row[]>([]);

  const [selectedCase, setSelectedCase] = useState<Row | null>(null);
  const [enrollmentEdit, setEnrollmentEdit] = useState<EnrollmentEdit>(emptyEnrollmentEdit);
  const [enrollmentBaseline, setEnrollmentBaseline] = useState<EnrollmentEdit>(emptyEnrollmentEdit);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void getCurrentTenantId()
      .then((tenantId) =>
        tenantRpc<number>("sync_provider_revalidation_work", {
          p_tenant_id: tenantId,
        }),
      )
      .catch(() => null);

    Promise.all([
      tenantSelect("v_credentialing_case_summary"),
      tenantSelect("v_provider_enrollment_matrix"),
      tenantSelect("v_credentialing_expirations"),
      tenantSelect("workqueue_items"),
      tenantSelect("credentialing_requirements"),
      tenantSelect("credentialing_followups"),
      tenantSelect("status_history"),
      tenantSelect("provider_payer_enrollments"),
    ])
      .then(
        ([
          caseRows,
          matrixRows,
          expirationRows,
          workRows,
          requirementRows,
          followupRows,
          historyRows,
          enrollmentRows,
        ]) => {
          if (!active) return;
          setCases(caseRows);
          setParticipation(matrixRows);
          setExpirations(expirationRows);
          setWorkItems(workRows);
          setRequirements(requirementRows);
          setFollowups(followupRows);
          setStatusHistory(historyRows);
          setEnrollments(enrollmentRows);
        },
      )
      .catch((err: unknown) => {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load credentialing workspace",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [version]);

  const credentialingWork = useMemo(
    () =>
      workItems
        .filter(
          (row) =>
            credentialingWorkTypes.has(String(row.workqueue_type || "")) &&
            !["completed", "cancelled"].includes(String(row.workqueue_status || "")),
        )
        .toSorted((a, b) => {
          const aDue = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
          const bDue = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
          return aDue - bDue;
        }),
    [workItems],
  );

  const activeApplications = cases.filter(
    (row) => !terminalApplicationStatuses.has(String(row.application_status || "")),
  );
  const awaitingProvider = cases.filter((row) =>
    awaitingProviderStatuses.has(String(row.application_status || "")),
  ).length;
  const awaitingPayer = cases.filter((row) =>
    awaitingPayerStatuses.has(String(row.application_status || "")),
  ).length;
  const payerRequests = cases.filter((row) =>
    payerRequestStatuses.has(String(row.application_status || "")),
  ).length;

  const expirationAction = expirations.filter((row) => {
    if (!row.due_date) return false;
    const due = new Date(String(row.due_date));
    const today = new Date();
    const days = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
    return days <= 90;
  }).length;

  const networkIssues = participation.filter((row) =>
    ["non_participating", "suspended"].includes(String(row.participation_status || "")) ||
    ["not_listed", "inaccurate"].includes(String(row.directory_status || "")),
  ).length;

  const selectedEnrollment = selectedCase?.enrollment_id
    ? enrollments.find((row) => row.id === selectedCase.enrollment_id) ?? null
    : null;

  const selectedRequirements = selectedCase?.application_id
    ? requirements.filter((row) => row.application_id === selectedCase.application_id)
    : [];
  const selectedFollowups = selectedCase?.application_id
    ? followups
        .filter((row) => row.application_id === selectedCase.application_id)
        .toSorted((a, b) => String(b.followup_date).localeCompare(String(a.followup_date)))
    : [];
  const selectedHistory = selectedCase?.application_id
    ? statusHistory
        .filter(
          (row) =>
            row.target_type === "credentialing_application" &&
            row.target_id === selectedCase.application_id,
        )
        .toSorted((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    : [];

  const selectedWork = selectedCase
    ? credentialingWork.filter((row) =>
        [
          selectedCase.application_id,
          selectedCase.enrollment_id,
          selectedCase.participation_id,
          selectedCase.provider_id,
        ]
          .filter(Boolean)
          .includes(row.source_object_id),
      )
    : [];

  const drawerCases = cases.length ? cases : participation;
  const selectedIndex = selectedCase
    ? drawerCases.findIndex(
        (row) =>
          (selectedCase.application_id &&
            row.application_id === selectedCase.application_id) ||
          row.enrollment_id === selectedCase.enrollment_id,
      )
    : -1;

  const enrollmentDirty =
    JSON.stringify(enrollmentEdit) !== JSON.stringify(enrollmentBaseline);

  function openCase(row: Row) {
    const matchingCase =
      cases.find((item) => item.enrollment_id === row.enrollment_id) ?? row;
    const enrollment =
      enrollments.find((item) => item.id === matchingCase.enrollment_id) ?? null;
    const nextEdit: EnrollmentEdit = enrollment
      ? {
          effective_date: enrollment.effective_date || "",
          revalidation_due_date: enrollment.revalidation_due_date || "",
          termination_date: enrollment.termination_date || "",
          payer_provider_id: enrollment.payer_provider_id || "",
          notes: enrollment.notes || "",
        }
      : emptyEnrollmentEdit();

    setSelectedCase(matchingCase);
    setDrawerTab("overview");
    setEnrollmentEdit(nextEdit);
    setEnrollmentBaseline({ ...nextEdit });
  }

  function closeCase() {
    setSelectedCase(null);
    setDrawerTab("overview");
    setEnrollmentEdit(emptyEnrollmentEdit());
    setEnrollmentBaseline(emptyEnrollmentEdit());
  }

  function openCaseAt(index: number) {
    const row = drawerCases[index];
    if (row) openCase(row);
  }

  async function saveEnrollment() {
    if (!selectedEnrollment) return;
    setSaving(true);
    setError(null);
    try {
      await tenantUpdate("provider_payer_enrollments", selectedEnrollment.id, {
        effective_date: enrollmentEdit.effective_date || null,
        revalidation_due_date: enrollmentEdit.revalidation_due_date || null,
        termination_date: enrollmentEdit.termination_date || null,
        payer_provider_id: enrollmentEdit.payer_provider_id || null,
        notes: enrollmentEdit.notes || null,
      });
      setEnrollmentBaseline({ ...enrollmentEdit });
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save enrollment");
    } finally {
      setSaving(false);
    }
  }

  async function transitionEnrollment(nextStatus: EnrollmentStatus, reason: string) {
    if (!selectedEnrollment) return;
    setSaving(true);
    setError(null);
    try {
      const tenantId = await getCurrentTenantId();
      await tenantRpc<string>("transition_provider_enrollment", {
        p_tenant_id: tenantId,
        p_enrollment_id: selectedEnrollment.id,
        p_enrollment_status: nextStatus,
        p_reason: reason,
      });
      setVersion((value) => value + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update enrollment workflow",
      );
    } finally {
      setSaving(false);
    }
  }

  function caseForWorkItem(item: Row) {
    return (
      cases.find((row) =>
        [
          row.application_id,
          row.enrollment_id,
          row.participation_id,
          row.provider_id,
        ]
          .filter(Boolean)
          .includes(item.source_object_id),
      ) ?? null
    );
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">PAYER OPERATIONS</div>
          <h1>Credentialing</h1>
          <p>
            Applications, payer enrollment, network participation, roster work,
            verification and recredentialing in one operational workspace.
          </p>
        </div>
        <div className="thera-filter-row">
          <button
            type="button"
            className="thera-action secondary"
            onClick={() => navigate("/providers")}
          >
            Providers
          </button>
          <button
            type="button"
            className="thera-action"
            onClick={() => navigate("/payers-contracts")}
          >
            Payers &amp; Contracts
          </button>
        </div>
      </div>

      <div className="thera-metric-grid">
        <div className="thera-metric-card">
          <div className="thera-metric-label">Active Applications</div>
          <div className="thera-metric-value">{activeApplications.length}</div>
        </div>
        <div className="thera-metric-card">
          <div className="thera-metric-label">Awaiting Provider</div>
          <div className="thera-metric-value">{awaitingProvider}</div>
        </div>
        <div className="thera-metric-card">
          <div className="thera-metric-label">Awaiting Payer</div>
          <div className="thera-metric-value">{awaitingPayer}</div>
        </div>
        <div className="thera-metric-card">
          <div className="thera-metric-label">Payer Requests</div>
          <div className="thera-metric-value">{payerRequests}</div>
        </div>
        <div className="thera-metric-card">
          <div className="thera-metric-label">Expiration Action</div>
          <div className="thera-metric-value">{expirationAction}</div>
        </div>
        <div className="thera-metric-card">
          <div className="thera-metric-label">Network Issues</div>
          <div className="thera-metric-value">{networkIssues}</div>
        </div>
      </div>

      <div
        className="thera-filter-row"
        role="tablist"
        aria-label="Credentialing workspace"
        style={{ marginBottom: 16 }}
      >
        {([
          ["work", "Work Queue"],
          ["applications", "Applications"],
          ["participation", "Participation Matrix"],
          ["expirations", "Expirations"],
        ] as const).map(([id, label]) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={workspaceTab === id}
            className={workspaceTab === id ? "thera-action" : "thera-action secondary"}
            onClick={() => setWorkspaceTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <div className="thera-state error">{error}</div> : null}
      {loading ? <div className="thera-state">Loading credentialing workspace...</div> : null}

      {!loading && workspaceTab === "work" ? (
        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <h2>Work Queue</h2>
              <p>
                Credentialing work uses the universal workqueue so assignment,
                priority, due dates and history stay consistent across Therassistant.
              </p>
            </div>
          </div>
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>Work</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Due</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {credentialingWork.length === 0 ? (
                  <tr><td colSpan={6}>No open credentialing work.</td></tr>
                ) : null}
                {credentialingWork.map((item) => {
                  const linkedCase = caseForWorkItem(item);
                  return (
                    <tr
                      key={item.id}
                      onClick={() => linkedCase && openCase(linkedCase)}
                      style={{ cursor: linkedCase ? "pointer" : "default" }}
                    >
                      <td>
                        <strong>{item.title}</strong>
                        {item.description ? <div>{item.description}</div> : null}
                      </td>
                      <td>{String(item.workqueue_type || "—").replaceAll("_", " ")}</td>
                      <td><StatusBadge value={item.workqueue_status} /></td>
                      <td><StatusBadge value={item.priority} /></td>
                      <td>{shortDate(item.due_date)}</td>
                      <td>{linkedCase?.provider_name || linkedCase?.payer_name || "Credentialing"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!loading && workspaceTab === "applications" ? (
        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <h2>Applications</h2>
              <p>
                Approval is a milestone. A case is complete only after effective
                participation, roster confirmation and directory verification.
              </p>
            </div>
          </div>
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Payer</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>Age</th>
                  <th>Next Follow-Up</th>
                  <th>Priority</th>
                </tr>
              </thead>
              <tbody>
                {cases.length === 0 ? (
                  <tr><td colSpan={9}>No credentialing applications on file.</td></tr>
                ) : null}
                {cases.map((row) => (
                  <tr key={row.application_id} onClick={() => openCase(row)} style={{ cursor: "pointer" }}>
                    <td>{row.provider_name || "—"}</td>
                    <td>{row.payer_name || "—"}</td>
                    <td>{row.payer_plan_name || "All products"}</td>
                    <td>{String(row.application_type || "—").replaceAll("_", " ")}</td>
                    <td><StatusBadge value={row.application_status} /></td>
                    <td>{shortDate(row.submitted_date)}</td>
                    <td>{row.application_age_days ?? "—"}{row.application_age_days != null ? " days" : ""}</td>
                    <td>{shortDate(row.next_followup_date)}</td>
                    <td><StatusBadge value={row.priority} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!loading && workspaceTab === "participation" ? (
        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <h2>Participation Matrix</h2>
              <p>
                Provider × payer × product × legal entity × location participation
                and directory status.
              </p>
            </div>
          </div>
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Payer</th>
                  <th>Product</th>
                  <th>Entity</th>
                  <th>Location</th>
                  <th>Enrollment</th>
                  <th>Participation</th>
                  <th>Directory</th>
                  <th>Effective</th>
                  <th>Verified</th>
                </tr>
              </thead>
              <tbody>
                {participation.length === 0 ? (
                  <tr><td colSpan={10}>No payer enrollment records on file.</td></tr>
                ) : null}
                {participation.map((row) => (
                  <tr key={row.enrollment_id} onClick={() => openCase(row)} style={{ cursor: "pointer" }}>
                    <td>{row.provider_name || "—"}</td>
                    <td>{row.payer_name || "—"}</td>
                    <td>{row.payer_plan_name || "All products"}</td>
                    <td>{row.practice_entity_name || "—"}</td>
                    <td>{row.practice_location_name || "—"}</td>
                    <td><StatusBadge value={row.enrollment_status} /></td>
                    <td><StatusBadge value={row.participation_status || "unknown"} /></td>
                    <td><StatusBadge value={row.directory_status || "unknown"} /></td>
                    <td>{shortDate(row.effective_date)}</td>
                    <td>{shortDate(row.participation_last_verified_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!loading && workspaceTab === "expirations" ? (
        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <h2>Expirations</h2>
              <p>
                Provider credentials, CAQH attestations, payer revalidation and
                contract recredentialing due dates.
              </p>
            </div>
          </div>
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Item</th>
                  <th>Type</th>
                  <th>Payer</th>
                  <th>Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {expirations.length === 0 ? (
                  <tr><td colSpan={6}>No credentialing expirations on file.</td></tr>
                ) : null}
                {expirations
                  .toSorted((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")))
                  .map((row) => (
                    <tr key={`${row.source_type}-${row.source_id}`}>
                      <td>{row.provider_name || "—"}</td>
                      <td>{row.item_name || "—"}</td>
                      <td>{String(row.source_type || "—").replaceAll("_", " ")}</td>
                      <td>{row.payer_name || "—"}</td>
                      <td>{shortDate(row.due_date)}</td>
                      <td><StatusBadge value={row.current_status || "unknown"} /></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {selectedCase ? (
        <WorkDrawer
          open={Boolean(selectedCase)}
          onOpenChange={(open) => {
            if (!open) closeCase();
          }}
          dirty={enrollmentDirty}
          title="Credentialing Case"
          subtitle={`${selectedCase.provider_name || "Provider"} · ${selectedCase.payer_name || "Payer"}${selectedCase.payer_plan_name ? ` · ${selectedCase.payer_plan_name}` : ""}`}
          badges={
            <>
              <StatusBadge value={selectedCase.application_status || selectedCase.enrollment_status} />
              <StatusBadge value={selectedCase.participation_status || "unknown"} />
            </>
          }
          queuePosition={
            selectedIndex >= 0
              ? `${selectedIndex + 1} of ${drawerCases.length}`
              : undefined
          }
          onPrevious={selectedIndex > 0 ? () => openCaseAt(selectedIndex - 1) : undefined}
          onNext={
            selectedIndex >= 0 && selectedIndex < drawerCases.length - 1
              ? () => openCaseAt(selectedIndex + 1)
              : undefined
          }
          openFullRecord={
            selectedCase.provider_id
              ? () => navigate(`/providers/${selectedCase.provider_id}`)
              : undefined
          }
          openFullRecordLabel="Open Provider 360"
          footer={
            selectedEnrollment ? (
              <div className="thera-filter-row" style={{ justifyContent: "space-between" }}>
                <button type="button" className="thera-action secondary" onClick={closeCase}>
                  Close
                </button>
                <button
                  type="button"
                  className="thera-action"
                  disabled={saving || !enrollmentDirty}
                  onClick={() => void saveEnrollment()}
                >
                  {saving ? "Saving..." : "Save Enrollment"}
                </button>
              </div>
            ) : (
              <button type="button" className="thera-action secondary" onClick={closeCase}>
                Close
              </button>
            )
          }
        >
          <div className="thera-filter-row" role="tablist" aria-label="Credentialing case">
            {([
              ["overview", "Overview"],
              ["requirements", "Requirements"],
              ["followup", "Follow-Up"],
              ["history", "History"],
            ] as const).map(([id, label]) => (
              <button
                type="button"
                key={id}
                role="tab"
                aria-selected={drawerTab === id}
                className={drawerTab === id ? "thera-action" : "thera-action secondary"}
                onClick={() => setDrawerTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {drawerTab === "overview" ? (
            <div className="thera-stack">
              <section className="thera-card">
                <h2>Scope</h2>
                <div className="thera-definition-grid">
                  <Field name="Provider" value={selectedCase.provider_name || "—"} />
                  <Field name="NPI" value={selectedCase.individual_npi || "—"} />
                  <Field name="Payer" value={selectedCase.payer_name || "—"} />
                  <Field name="Product" value={selectedCase.payer_plan_name || "All products"} />
                  <Field name="Entity / TIN" value={selectedCase.practice_entity_name || "—"} />
                  <Field name="Location" value={selectedCase.practice_location_name || "—"} />
                  <Field name="Contract" value={selectedCase.contract_name || "—"} />
                  <Field name="Application Type" value={String(selectedCase.application_type || "—").replaceAll("_", " ")} />
                </div>
              </section>

              <section className="thera-card">
                <h2>Case Status</h2>
                <div className="thera-definition-grid">
                  <Field name="Application" value={<StatusBadge value={selectedCase.application_status || "not_started"} />} />
                  <Field name="Enrollment" value={<StatusBadge value={selectedCase.enrollment_status || "unknown"} />} />
                  <Field name="Participation" value={<StatusBadge value={selectedCase.participation_status || "unknown"} />} />
                  <Field name="Directory" value={<StatusBadge value={selectedCase.directory_status || "unknown"} />} />
                  <Field name="Submitted" value={shortDate(selectedCase.submitted_date)} />
                  <Field name="Decision" value={shortDate(selectedCase.decision_date)} />
                  <Field name="Last Payer Contact" value={shortDate(selectedCase.last_contact_date)} />
                  <Field name="Next Follow-Up" value={shortDate(selectedCase.next_followup_date)} />
                  <Field name="Application Age" value={selectedCase.application_age_days != null ? `${selectedCase.application_age_days} days` : "—"} />
                  <Field name="Missing Requirements" value={selectedCase.missing_requirements ?? 0} />
                  <Field name="Payer Provider ID" value={selectedCase.payer_provider_id || "—"} />
                  <Field name="Last Network Verification" value={shortDate(selectedCase.participation_last_verified_at)} />
                </div>
              </section>

              {selectedWork.length ? (
                <section className="thera-card">
                  <h2>Open Work</h2>
                  <div className="thera-stack">
                    {selectedWork.map((item) => (
                      <div className="thera-alert warning" key={item.id}>
                        <div className="thera-row-between">
                          <strong>{item.title}</strong>
                          <StatusBadge value={item.priority} />
                        </div>
                        <div>{item.description || String(item.workqueue_type).replaceAll("_", " ")}</div>
                        <div>Due {shortDate(item.due_date)}</div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {selectedEnrollment ? (
                <section className="thera-card">
                  <h2>Enrollment Details</h2>
                  <div className="thera-form-grid">
                    <label>
                      Effective Date
                      <input
                        className="thera-input"
                        type="date"
                        value={enrollmentEdit.effective_date}
                        onChange={(event) =>
                          setEnrollmentEdit({ ...enrollmentEdit, effective_date: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Revalidation Due
                      <input
                        className="thera-input"
                        type="date"
                        value={enrollmentEdit.revalidation_due_date}
                        onChange={(event) =>
                          setEnrollmentEdit({ ...enrollmentEdit, revalidation_due_date: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Termination Date
                      <input
                        className="thera-input"
                        type="date"
                        value={enrollmentEdit.termination_date}
                        onChange={(event) =>
                          setEnrollmentEdit({ ...enrollmentEdit, termination_date: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Payer Provider ID
                      <input
                        className="thera-input"
                        value={enrollmentEdit.payer_provider_id}
                        onChange={(event) =>
                          setEnrollmentEdit({ ...enrollmentEdit, payer_provider_id: event.target.value })
                        }
                      />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>
                      Notes
                      <textarea
                        className="thera-input"
                        rows={4}
                        value={enrollmentEdit.notes}
                        onChange={(event) =>
                          setEnrollmentEdit({ ...enrollmentEdit, notes: event.target.value })
                        }
                      />
                    </label>
                  </div>

                  <div className="thera-filter-row" style={{ marginTop: 16 }}>
                    {availableEnrollmentActions(
                      selectedEnrollment.enrollment_status as EnrollmentStatus,
                    ).map((action) => (
                      <button
                        type="button"
                        className="thera-action secondary"
                        key={action.nextStatus}
                        disabled={saving}
                        onClick={() =>
                          void transitionEnrollment(action.nextStatus, action.label)
                        }
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {drawerTab === "requirements" ? (
            <section className="thera-card">
              <h2>Requirements</h2>
              <div className="thera-table-wrap">
                <table className="thera-table">
                  <thead><tr><th>Requirement</th><th>Category</th><th>Status</th><th>Due</th><th>Received</th></tr></thead>
                  <tbody>
                    {selectedRequirements.length === 0 ? (
                      <tr><td colSpan={5}>No application requirements recorded.</td></tr>
                    ) : null}
                    {selectedRequirements.map((row) => (
                      <tr key={row.id}>
                        <td>{row.requirement_name}</td>
                        <td>{row.category || "—"}</td>
                        <td><StatusBadge value={row.status} /></td>
                        <td>{shortDate(row.due_date)}</td>
                        <td>{shortDate(row.received_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {drawerTab === "followup" ? (
            <section className="thera-card">
              <h2>Follow-Up</h2>
              <div className="thera-table-wrap">
                <table className="thera-table">
                  <thead><tr><th>Date</th><th>Channel</th><th>Contact</th><th>Outcome</th><th>Reference</th><th>Next</th></tr></thead>
                  <tbody>
                    {selectedFollowups.length === 0 ? (
                      <tr><td colSpan={6}>No payer follow-up history recorded.</td></tr>
                    ) : null}
                    {selectedFollowups.map((row) => (
                      <tr key={row.id}>
                        <td>{shortDate(row.followup_date)}</td>
                        <td>{row.channel || "—"}</td>
                        <td>{row.contact_name || "—"}</td>
                        <td>{row.outcome || row.notes || "—"}</td>
                        <td>{row.reference_number || "—"}</td>
                        <td>{shortDate(row.next_followup_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {drawerTab === "history" ? (
            <section className="thera-card">
              <h2>History</h2>
              <div className="thera-table-wrap">
                <table className="thera-table">
                  <thead><tr><th>Date</th><th>From</th><th>To</th><th>Reason</th></tr></thead>
                  <tbody>
                    {selectedHistory.length === 0 ? (
                      <tr><td colSpan={4}>No application status history recorded.</td></tr>
                    ) : null}
                    {selectedHistory.map((row) => (
                      <tr key={row.id}>
                        <td>{shortDate(row.created_at)}</td>
                        <td><StatusBadge value={row.old_status || "new"} /></td>
                        <td><StatusBadge value={row.new_status} /></td>
                        <td>{row.reason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </WorkDrawer>
      ) : null}
    </>
  );
}

function Field({ name, value }: { name: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="thera-field-label">{name}</div>
      <div className="thera-field-value">{value}</div>
    </div>
  );
}
