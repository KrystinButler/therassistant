import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { WorkDrawer } from "../../components/work-drawer";
import { shortDate } from "../../lib/format";
import { storageClient } from "../../lib/storage-client";
import {
  getCurrentTenantId,
  tenantInsert,
  tenantRpc,
  tenantSelect,
  tenantUpdate,
} from "../../lib/tenant-data-client";
import {
  buildApplicationAgingSummary,
  buildExpirationSummary,
  buildParticipationSummary,
  buildRosterSummary,
  downloadCsv,
} from "./reports";
import {
  availableEnrollmentActions,
  type EnrollmentStatus,
} from "./workflow";

type Row = Record<string, any>;
type WorkspaceTab =
  | "work"
  | "applications"
  | "participation"
  | "roster"
  | "expirations"
  | "reports";
type DrawerTab =
  | "overview"
  | "requirements"
  | "followup"
  | "documents"
  | "verification"
  | "roster"
  | "history";

type EnrollmentEdit = {
  effective_date: string;
  revalidation_due_date: string;
  termination_date: string;
  payer_provider_id: string;
  notes: string;
};

type VerificationForm = {
  verification_method: string;
  result: string;
  directory_status: string;
  reference_number: string;
  representative_name: string;
  source_url: string;
  notes: string;
  next_verification_due_date: string;
};

type RosterActionForm = {
  action_type: string;
  requested_change: string;
  notes: string;
  due_date: string;
  priority: string;
};

type RosterTransitionForm = {
  status: string;
  reference_number: string;
  notes: string;
};

const rosterActionTypes = [
  "add_provider",
  "remove_provider",
  "update_demographics",
  "add_location",
  "remove_location",
  "correct_name",
  "correct_npi",
  "correct_tin",
  "correct_taxonomy",
  "add_product",
  "remove_product",
  "other",
] as const;

const rosterTerminalStatuses = new Set(["confirmed", "cancelled"]);

const rosterTransitionMap: Record<string, string[]> = {
  not_started: ["ready", "cancelled"],
  ready: ["submitted", "cancelled"],
  submitted: ["pending", "confirmed", "rejected", "cancelled"],
  pending: ["confirmed", "rejected", "cancelled"],
  rejected: ["ready", "cancelled"],
  confirmed: [],
  cancelled: [],
};

function rosterTransitionOptions(status: string): string[] {
  return rosterTransitionMap[status] ?? [];
}

const credentialingDocumentTypes = [
  "provider_license",
  "dea_registration",
  "malpractice_insurance",
  "w9",
  "caqh_profile",
  "curriculum_vitae",
  "credentialing_application",
  "credentialing_approval",
  "network_verification",
  "roster_document",
  "payer_contract",
  "provider_certification",
  "other",
] as const;

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

function emptyVerificationForm(): VerificationForm {
  return {
    verification_method: "payer_portal",
    result: "participating",
    directory_status: "listed",
    reference_number: "",
    representative_name: "",
    source_url: "",
    notes: "",
    next_verification_due_date: "",
  };
}

function emptyRosterActionForm(): RosterActionForm {
  return {
    action_type: "add_provider",
    requested_change: "",
    notes: "",
    due_date: "",
    priority: "normal",
  };
}

function emptyRosterTransitionForm(): RosterTransitionForm {
  return {
    status: "ready",
    reference_number: "",
    notes: "",
  };
}

export function CredentialingPage() {
  const [, navigate] = useLocation();
  const [version, setVersion] = useState(0);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("participation");
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
  const [documents, setDocuments] = useState<Row[]>([]);
  const [documentLinks, setDocumentLinks] = useState<Row[]>([]);
  const [verificationRows, setVerificationRows] = useState<Row[]>([]);
  const [networkParticipationRows, setNetworkParticipationRows] = useState<Row[]>([]);
  const [rosterActions, setRosterActions] = useState<Row[]>([]);

  const [selectedCase, setSelectedCase] = useState<Row | null>(null);
  const [enrollmentEdit, setEnrollmentEdit] = useState<EnrollmentEdit>(emptyEnrollmentEdit);
  const [enrollmentBaseline, setEnrollmentBaseline] = useState<EnrollmentEdit>(emptyEnrollmentEdit);
  const [documentType, setDocumentType] = useState<string>("credentialing_application");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [verificationForm, setVerificationForm] = useState<VerificationForm>(emptyVerificationForm);
  const [verificationEvidenceFile, setVerificationEvidenceFile] = useState<File | null>(null);
  const [recordingVerification, setRecordingVerification] = useState(false);
  const [rosterForm, setRosterForm] = useState<RosterActionForm>(emptyRosterActionForm);
  const [creatingRosterAction, setCreatingRosterAction] = useState(false);
  const [selectedRosterActionId, setSelectedRosterActionId] = useState<string | null>(null);
  const [rosterTransitionForm, setRosterTransitionForm] =
    useState<RosterTransitionForm>(emptyRosterTransitionForm);
  const [updatingRosterAction, setUpdatingRosterAction] = useState(false);

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
      tenantSelect("documents"),
      tenantSelect("credentialing_document_links"),
      tenantSelect("participation_verifications"),
      tenantSelect("provider_network_participation"),
      tenantSelect("roster_actions"),
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
          documentRows,
          documentLinkRows,
          verificationHistoryRows,
          networkParticipationHistoryRows,
          rosterActionRows,
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
          setDocuments(documentRows);
          setDocumentLinks(documentLinkRows);
          setVerificationRows(verificationHistoryRows);
          setNetworkParticipationRows(networkParticipationHistoryRows);
          setRosterActions(rosterActionRows);
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

  const activeRosterActions = rosterActions.filter(
    (row) => !rosterTerminalStatuses.has(String(row.status || "")),
  ).length;

  const rosterRows = rosterActions
    .map((action) => {
      const caseRow =
        participation.find((row) => row.enrollment_id === action.enrollment_id) ??
        cases.find((row) => row.enrollment_id === action.enrollment_id) ??
        null;
      const work =
        workItems.find(
          (row) =>
            row.workqueue_type === "roster_action" &&
            row.source_object_type === "roster_action" &&
            row.source_object_id === action.id,
        ) ?? null;
      return { action, caseRow, work };
    })
    .toSorted((a, b) =>
      String(b.action.created_at || "").localeCompare(String(a.action.created_at || "")),
    );

  const applicationAgingSummary = buildApplicationAgingSummary(cases);
  const participationSummary = buildParticipationSummary(participation);
  const expirationSummary = buildExpirationSummary(expirations);
  const rosterSummary = buildRosterSummary(rosterActions);
  const networkDirectoryExceptions = participation.filter(
    (row) =>
      ["non_participating", "suspended"].includes(
        String(row.participation_status || ""),
      ) ||
      ["not_listed", "inaccurate"].includes(String(row.directory_status || "")),
  );

  const selectedEnrollment = selectedCase?.enrollment_id
    ? enrollments.find((row) => row.id === selectedCase.enrollment_id) ?? null
    : null;

  const selectedNetworkParticipation = selectedCase?.enrollment_id
    ? networkParticipationRows.find(
        (row) => row.enrollment_id === selectedCase.enrollment_id,
      ) ?? null
    : null;
  const selectedParticipationId =
    selectedNetworkParticipation?.id || selectedCase?.participation_id || null;

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

  const selectedVerificationRows = selectedParticipationId
    ? verificationRows
        .filter((row) => row.participation_id === selectedParticipationId)
        .toSorted((a, b) => String(b.verified_at).localeCompare(String(a.verified_at)))
    : [];

  const selectedDocumentLinks = selectedCase
    ? documentLinks.filter((row) =>
        Boolean(
          (selectedCase.application_id && row.application_id === selectedCase.application_id) ||
          (selectedCase.enrollment_id && row.enrollment_id === selectedCase.enrollment_id) ||
          (selectedParticipationId && row.participation_id === selectedParticipationId) ||
          (selectedCase.provider_id && row.provider_id === selectedCase.provider_id),
        ),
      )
    : [];

  const selectedCredentialingDocuments = selectedDocumentLinks
    .flatMap((link) => {
      const document = documents.find((row) => row.id === link.document_id);
      return document ? [{ link, document }] : [];
    })
    .filter(
      (entry, index, rows) =>
        rows.findIndex((candidate) => candidate.document.id === entry.document.id) === index,
    );

  const selectedRosterActions = selectedCase?.enrollment_id
    ? rosterActions
        .filter((row) => row.enrollment_id === selectedCase.enrollment_id)
        .toSorted((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    : [];

  const selectedRosterAction = selectedRosterActionId
    ? selectedRosterActions.find((row) => row.id === selectedRosterActionId) ?? null
    : null;

  const selectedWork = selectedCase
    ? credentialingWork.filter((row) =>
        [
          selectedCase.application_id,
          selectedCase.enrollment_id,
          selectedCase.participation_id,
          selectedCase.provider_id,
          ...selectedRosterActions.map((action) => action.id),
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
    setDocumentType("credentialing_application");
    setDocumentFile(null);
    setVerificationForm(emptyVerificationForm());
    setVerificationEvidenceFile(null);
    setRosterForm(emptyRosterActionForm());
    setSelectedRosterActionId(null);
    setRosterTransitionForm(emptyRosterTransitionForm());
  }

  function closeCase() {
    setSelectedCase(null);
    setDrawerTab("overview");
    setEnrollmentEdit(emptyEnrollmentEdit());
    setEnrollmentBaseline(emptyEnrollmentEdit());
    setDocumentFile(null);
    setVerificationForm(emptyVerificationForm());
    setVerificationEvidenceFile(null);
    setRosterForm(emptyRosterActionForm());
    setSelectedRosterActionId(null);
    setRosterTransitionForm(emptyRosterTransitionForm());
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

  async function saveCredentialingDocument(
    file: File,
    type: string,
    linkOverrides: Row = {},
  ) {
    if (!selectedCase?.enrollment_id && !selectedCase?.application_id) {
      throw new Error("Credentialing case scope is required.");
    }

    const tenantId = await getCurrentTenantId();
    const recordType = linkOverrides.verification_id
      ? "verification"
      : selectedCase.application_id
        ? "application"
        : "enrollment";
    const recordId =
      String(
        linkOverrides.verification_id ||
          selectedCase.application_id ||
          selectedCase.enrollment_id,
      );

    const uploaded = await storageClient.uploadCredentialingFile({
      tenantId,
      recordType,
      recordId,
      file,
      fileName: file.name,
      contentType: file.type || undefined,
    });

    let document: Row;
    try {
      document = await tenantInsert("documents", {
        document_type: type,
        document_status: "uploaded",
        file_name: file.name,
        storage_path: uploaded.path,
        mime_type: file.type || null,
        file_size_bytes: file.size,
      });
    } catch (documentError) {
      try {
        await storageClient.deleteObject(uploaded.path);
      } catch (cleanupError) {
        throw new Error(
          `${documentError instanceof Error ? documentError.message : String(documentError)} Storage cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        );
      }
      throw documentError;
    }

    try {
      await tenantInsert("credentialing_document_links", {
        document_id: document.id,
        provider_id: selectedCase.provider_id || null,
        enrollment_id: selectedCase.enrollment_id || null,
        application_id: selectedCase.application_id || null,
        participation_id:
          linkOverrides.participation_id || selectedParticipationId || null,
        verification_id: linkOverrides.verification_id || null,
        payer_contract_id: selectedCase.payer_contract_id || null,
        link_type:
          linkOverrides.verification_id
            ? "network_verification_evidence"
            : "credentialing_document",
      });
    } catch (linkError) {
      throw new Error(
        `The document was saved but could not be linked to this credentialing case. ${linkError instanceof Error ? linkError.message : String(linkError)}`,
      );
    }

    return document;
  }

  async function uploadDocument() {
    if (!documentFile) return;
    setUploadingDocument(true);
    setError(null);
    try {
      await saveCredentialingDocument(documentFile, documentType);
      setDocumentFile(null);
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload credentialing document");
    } finally {
      setUploadingDocument(false);
    }
  }

  async function openDocument(storagePath: string) {
    setError(null);
    try {
      const url = await storageClient.createSignedDocumentUrl(storagePath, 300);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open credentialing document");
    }
  }

  async function recordNetworkVerification() {
    if (!selectedCase?.enrollment_id || !verificationForm.verification_method.trim()) return;
    setRecordingVerification(true);
    setError(null);
    try {
      const tenantId = await getCurrentTenantId();
      const result = await tenantRpc<Row[]>("record_network_participation_verification", {
        p_tenant_id: tenantId,
        p_enrollment_id: selectedCase.enrollment_id,
        p_verification_method: verificationForm.verification_method,
        p_result: verificationForm.result,
        p_directory_status: verificationForm.directory_status,
        p_reference_number: verificationForm.reference_number || null,
        p_representative_name: verificationForm.representative_name || null,
        p_source_url: verificationForm.source_url || null,
        p_notes: verificationForm.notes || null,
        p_next_verification_due_date:
          verificationForm.next_verification_due_date || null,
        p_verified_at: new Date().toISOString(),
      });

      const verification = result[0];
      if (!verification?.participation_id || !verification?.verification_id) {
        throw new Error("Verification was saved but returned no record identifiers.");
      }

      if (verificationEvidenceFile) {
        await saveCredentialingDocument(
          verificationEvidenceFile,
          "network_verification",
          {
            participation_id: verification.participation_id,
            verification_id: verification.verification_id,
          },
        );
      }

      setSelectedCase((current) =>
        current
          ? {
              ...current,
              participation_id: verification.participation_id,
              participation_status: verificationForm.result,
              directory_status: verificationForm.directory_status,
              participation_last_verified_at: new Date().toISOString(),
            }
          : current,
      );
      setVerificationForm(emptyVerificationForm());
      setVerificationEvidenceFile(null);
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record network verification");
    } finally {
      setRecordingVerification(false);
    }
  }

  async function createRosterAction() {
    if (!selectedCase?.enrollment_id) return;
    setCreatingRosterAction(true);
    setError(null);
    try {
      const tenantId = await getCurrentTenantId();
      await tenantRpc<Row[]>("create_roster_action_work", {
        p_tenant_id: tenantId,
        p_enrollment_id: selectedCase.enrollment_id,
        p_action_type: rosterForm.action_type,
        p_participation_id: selectedParticipationId,
        p_requested_change: rosterForm.requested_change.trim()
          ? { details: rosterForm.requested_change.trim() }
          : {},
        p_notes: rosterForm.notes.trim() || null,
        p_due_date: rosterForm.due_date || null,
        p_priority: rosterForm.priority,
      });
      setRosterForm(emptyRosterActionForm());
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create roster action");
    } finally {
      setCreatingRosterAction(false);
    }
  }

  function manageRosterAction(action: Row) {
    const currentStatus = String(action.status || "ready");
    const nextStatuses = rosterTransitionOptions(currentStatus);
    setSelectedRosterActionId(String(action.id));
    setRosterTransitionForm({
      status: nextStatuses[0] || currentStatus,
      reference_number: String(action.reference_number || ""),
      notes: String(action.notes || ""),
    });
  }

  async function updateRosterAction() {
    if (!selectedRosterAction) return;
    setUpdatingRosterAction(true);
    setError(null);
    try {
      const tenantId = await getCurrentTenantId();
      await tenantRpc<unknown>("transition_roster_action", {
        p_tenant_id: tenantId,
        p_roster_action_id: selectedRosterAction.id,
        p_status: rosterTransitionForm.status,
        p_reference_number: rosterTransitionForm.reference_number.trim() || null,
        p_notes: rosterTransitionForm.notes.trim() || null,
      });
      setSelectedRosterActionId(null);
      setRosterTransitionForm(emptyRosterTransitionForm());
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update roster action");
    } finally {
      setUpdatingRosterAction(false);
    }
  }

  function exportApplicationAgingCsv() {
    downloadCsv(
      "credentialing-application-aging.csv",
      [
        "Provider",
        "Payer",
        "Product",
        "Application Type",
        "Status",
        "Submitted",
        "Age Days",
        "Next Follow-Up",
        "Priority",
      ],
      cases.map((row) => [
        row.provider_name || "",
        row.payer_name || "",
        row.payer_plan_name || "All products",
        row.application_type || "",
        row.application_status || "",
        row.submitted_date || "",
        row.application_age_days ?? "",
        row.next_followup_date || "",
        row.priority || "",
      ]),
    );
  }

  function exportParticipationCsv() {
    downloadCsv(
      "credentialing-participation.csv",
      [
        "Provider",
        "Payer",
        "Product",
        "Entity",
        "Location",
        "Enrollment Status",
        "Participation Status",
        "Directory Status",
        "Effective Date",
        "Last Verified",
      ],
      participation.map((row) => [
        row.provider_name || "",
        row.payer_name || "",
        row.payer_plan_name || "All products",
        row.practice_entity_name || "",
        row.practice_location_name || "",
        row.enrollment_status || "",
        row.participation_status || "unknown",
        row.directory_status || "unknown",
        row.effective_date || "",
        row.participation_last_verified_at || "",
      ]),
    );
  }

  function exportExpirationCsv() {
    downloadCsv(
      "credentialing-expirations.csv",
      ["Provider", "Item", "Type", "Payer", "Due Date", "Status"],
      expirations.map((row) => [
        row.provider_name || "",
        row.item_name || "",
        row.source_type || "",
        row.payer_name || "",
        row.due_date || "",
        row.current_status || "",
      ]),
    );
  }

  function exportRosterCsv() {
    downloadCsv(
      "credentialing-roster-actions.csv",
      [
        "Provider",
        "Payer",
        "Product",
        "Action",
        "Status",
        "Requested",
        "Submitted",
        "Confirmed",
        "Reference",
        "Due",
        "Priority",
      ],
      rosterRows.map(({ action, caseRow, work }) => [
        caseRow?.provider_name || "",
        caseRow?.payer_name || "",
        caseRow?.payer_plan_name || "All products",
        action.action_type || "",
        action.status || "",
        action.requested_date || "",
        action.submitted_date || "",
        action.confirmed_date || "",
        action.reference_number || "",
        work?.due_date || "",
        work?.priority || "",
      ]),
    );
  }

  function caseForWorkItem(item: Row) {
    if (item.source_object_type === "roster_action") {
      const rosterAction = rosterActions.find((row) => row.id === item.source_object_id);
      if (rosterAction) {
        return (
          cases.find((row) => row.enrollment_id === rosterAction.enrollment_id) ??
          participation.find((row) => row.enrollment_id === rosterAction.enrollment_id) ??
          null
        );
      }
    }

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
        <div className="thera-metric-card">
          <div className="thera-metric-label">Roster Actions</div>
          <div className="thera-metric-value">{activeRosterActions}</div>
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
          ["roster", "Roster Management"],
          ["expirations", "Expirations"],
          ["reports", "Reports"],
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
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {credentialingWork.length === 0 ? (
                  <tr><td colSpan={7}>No open credentialing work.</td></tr>
                ) : null}
                {credentialingWork.map((item) => {
                  const linkedCase = caseForWorkItem(item);
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>
                        {item.description ? <div>{item.description}</div> : null}
                      </td>
                      <td>{String(item.workqueue_type || "—").replaceAll("_", " ")}</td>
                      <td><StatusBadge value={item.workqueue_status} /></td>
                      <td><StatusBadge value={item.priority} /></td>
                      <td>{shortDate(item.due_date)}</td>
                      <td>{linkedCase?.provider_name || linkedCase?.payer_name || "Credentialing"}</td>
                      <td>
                        {linkedCase ? (
                          <button type="button" className="thera-action secondary" onClick={() => openCase(linkedCase)}>
                            Open Case
                          </button>
                        ) : "—"}
                      </td>
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
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {cases.length === 0 ? (
                  <tr><td colSpan={10}>No credentialing applications on file.</td></tr>
                ) : null}
                {cases.map((row) => (
                  <tr key={row.application_id}>
                    <td>{row.provider_name || "—"}</td>
                    <td>{row.payer_name || "—"}</td>
                    <td>{row.payer_plan_name || "All products"}</td>
                    <td>{String(row.application_type || "—").replaceAll("_", " ")}</td>
                    <td><StatusBadge value={row.application_status} /></td>
                    <td>{shortDate(row.submitted_date)}</td>
                    <td>{row.application_age_days ?? "—"}{row.application_age_days != null ? " days" : ""}</td>
                    <td>{shortDate(row.next_followup_date)}</td>
                    <td><StatusBadge value={row.priority} /></td>
                    <td>
                      <button type="button" className="thera-action secondary" onClick={() => openCase(row)}>
                        Open Case
                      </button>
                    </td>
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
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {participation.length === 0 ? (
                  <tr><td colSpan={11}>No payer enrollment records on file.</td></tr>
                ) : null}
                {participation.map((row) => (
                  <tr key={row.enrollment_id}>
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
                    <td>
                      <button type="button" className="thera-action secondary" onClick={() => openCase(row)}>
                        Open Case
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!loading && workspaceTab === "roster" ? (
        <section className="thera-card">
          <div className="thera-card-header">
            <div>
              <h2>Roster Management</h2>
              <p>
                Add, remove and correct provider participation data with each payer.
                Every active roster action is backed by the universal workqueue.
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
                  <th>Roster Action</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Submitted</th>
                  <th>Confirmed</th>
                  <th>Reference</th>
                  <th>Due</th>
                  <th>Priority</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rosterRows.length === 0 ? (
                  <tr><td colSpan={12}>No roster actions recorded.</td></tr>
                ) : null}
                {rosterRows.map(({ action, caseRow, work }) => (
                  <tr key={action.id}>
                    <td>{caseRow?.provider_name || "Provider unavailable"}</td>
                    <td>{caseRow?.payer_name || "Payer unavailable"}</td>
                    <td>{caseRow?.payer_plan_name || "All products"}</td>
                    <td>{String(action.action_type || "—").replaceAll("_", " ")}</td>
                    <td><StatusBadge value={action.status} /></td>
                    <td>{shortDate(action.requested_date)}</td>
                    <td>{shortDate(action.submitted_date)}</td>
                    <td>{shortDate(action.confirmed_date)}</td>
                    <td>{action.reference_number || "—"}</td>
                    <td>{shortDate(work?.due_date)}</td>
                    <td><StatusBadge value={work?.priority || "normal"} /></td>
                    <td>
                      {caseRow ? (
                        <button
                          type="button"
                          className="thera-action secondary"
                          onClick={() => {
                            openCase(caseRow);
                            setDrawerTab("roster");
                            manageRosterAction(action);
                          }}
                        >
                          Manage
                        </button>
                      ) : "—"}
                    </td>
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

      {!loading && workspaceTab === "reports" ? (
        <div className="thera-stack">
          <section className="thera-card">
            <div className="thera-card-header">
              <div>
                <h2>Credentialing Reports</h2>
                <p>
                  Operational reporting is calculated from the live credentialing
                  records already used by Applications, Participation, Expirations
                  and Roster Management.
                </p>
              </div>
            </div>
          </section>

          <section className="thera-card">
            <div className="thera-card-header">
              <div>
                <h2>Application Aging</h2>
                <p>Open applications grouped into 30-day payer aging bands.</p>
              </div>
              <button
                type="button"
                className="thera-action secondary"
                onClick={exportApplicationAgingCsv}
              >
                Export CSV
              </button>
            </div>
            <div className="thera-metric-grid">
              {applicationAgingSummary.map((row) => (
                <div className="thera-metric-card" key={row.label}>
                  <div className="thera-metric-label">{row.label} Days</div>
                  <div className="thera-metric-value">{row.count}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="thera-card">
            <div className="thera-card-header">
              <div>
                <h2>Participation Status</h2>
                <p>Current network participation across provider-payer scopes.</p>
              </div>
              <button
                type="button"
                className="thera-action secondary"
                onClick={exportParticipationCsv}
              >
                Export CSV
              </button>
            </div>
            <div className="thera-metric-grid">
              {participationSummary.length === 0 ? (
                <div className="thera-state">No participation records to summarize.</div>
              ) : null}
              {participationSummary.map((row) => (
                <div className="thera-metric-card" key={row.label}>
                  <div className="thera-metric-label">{row.label}</div>
                  <div className="thera-metric-value">{row.count}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="thera-card">
            <div className="thera-card-header">
              <div>
                <h2>Expirations</h2>
                <p>
                  Credential, CAQH, enrollment revalidation and contract
                  recredentialing deadlines.
                </p>
              </div>
              <button
                type="button"
                className="thera-action secondary"
                onClick={exportExpirationCsv}
              >
                Export CSV
              </button>
            </div>
            <div className="thera-metric-grid">
              {expirationSummary.map((row) => (
                <div className="thera-metric-card" key={row.label}>
                  <div className="thera-metric-label">{row.label}</div>
                  <div className="thera-metric-value">{row.count}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="thera-card">
            <div className="thera-card-header">
              <div>
                <h2>Roster Status</h2>
                <p>Current payer roster maintenance workload by lifecycle status.</p>
              </div>
              <button
                type="button"
                className="thera-action secondary"
                onClick={exportRosterCsv}
              >
                Export CSV
              </button>
            </div>
            <div className="thera-metric-grid">
              {rosterSummary.length === 0 ? (
                <div className="thera-state">No roster actions to summarize.</div>
              ) : null}
              {rosterSummary.map((row) => (
                <div className="thera-metric-card" key={row.label}>
                  <div className="thera-metric-label">{row.label}</div>
                  <div className="thera-metric-value">{row.count}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="thera-card">
            <div className="thera-card-header">
              <div>
                <h2>{"Network & Directory Exceptions"}</h2>
                <p>
                  Participation and payer-directory discrepancies that require
                  verification or corrective action.
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
                    <th>Location</th>
                    <th>Participation</th>
                    <th>Directory</th>
                    <th>Last Verified</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {networkDirectoryExceptions.length === 0 ? (
                    <tr><td colSpan={8}>No network or directory exceptions.</td></tr>
                  ) : null}
                  {networkDirectoryExceptions.map((row) => (
                    <tr key={row.enrollment_id}>
                      <td>{row.provider_name || "—"}</td>
                      <td>{row.payer_name || "—"}</td>
                      <td>{row.payer_plan_name || "All products"}</td>
                      <td>{row.practice_location_name || "—"}</td>
                      <td><StatusBadge value={row.participation_status || "unknown"} /></td>
                      <td><StatusBadge value={row.directory_status || "unknown"} /></td>
                      <td>{shortDate(row.participation_last_verified_at)}</td>
                      <td>
                        <button
                          type="button"
                          className="thera-action secondary"
                          onClick={() => {
                            openCase(row);
                            setDrawerTab("verification");
                          }}
                        >
                          Verify
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
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
              ["documents", "Documents"],
              ["verification", "Network Verification"],
              ["roster", "Roster"],
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

          {drawerTab === "documents" ? (
            <div className="thera-stack">
              <section className="thera-card">
                <div className="thera-card-header">
                  <div>
                    <h2>Documents</h2>
                    <p>
                      Credentialing documents and evidence remain in the existing
                      private document vault and are linked to this case.
                    </p>
                  </div>
                </div>
                <div className="thera-form-grid">
                  <label>
                    Document Type
                    <select
                      className="thera-input"
                      value={documentType}
                      onChange={(event) => setDocumentType(event.target.value)}
                    >
                      {credentialingDocumentTypes.map((type) => (
                        <option key={type} value={type}>
                          {type.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    File
                    <input
                      className="thera-input"
                      type="file"
                      onChange={(event) =>
                        setDocumentFile(event.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                </div>
                <div className="thera-filter-row" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="thera-action"
                    disabled={!documentFile || uploadingDocument}
                    onClick={() => void uploadDocument()}
                  >
                    {uploadingDocument ? "Uploading..." : "Upload Document"}
                  </button>
                </div>
              </section>

              <section className="thera-card">
                <div className="thera-table-wrap">
                  <table className="thera-table">
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Added</th>
                        <th>Evidence For</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedCredentialingDocuments.length === 0 ? (
                        <tr><td colSpan={6}>No credentialing documents linked to this case.</td></tr>
                      ) : null}
                      {selectedCredentialingDocuments.map(({ link, document }) => (
                        <tr key={document.id}>
                          <td>{document.file_name || "Document"}</td>
                          <td>{String(document.document_type || "other").replaceAll("_", " ")}</td>
                          <td><StatusBadge value={document.document_status || "uploaded"} /></td>
                          <td>{shortDate(document.created_at)}</td>
                          <td>
                            {link.verification_id
                              ? "Network verification"
                              : link.application_id
                                ? "Application"
                                : link.enrollment_id
                                  ? "Enrollment"
                                  : "Provider"}
                          </td>
                          <td>
                            {document.storage_path ? (
                              <button
                                type="button"
                                className="thera-action secondary"
                                onClick={() => void openDocument(String(document.storage_path))}
                              >
                                Open
                              </button>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : null}

          {drawerTab === "verification" ? (
            <div className="thera-stack">
              <section className="thera-card">
                <h2>Network Verification</h2>
                <div className="thera-definition-grid">
                  <Field
                    name="Current Participation"
                    value={<StatusBadge value={selectedCase.participation_status || "unknown"} />}
                  />
                  <Field
                    name="Directory Status"
                    value={<StatusBadge value={selectedCase.directory_status || "unknown"} />}
                  />
                  <Field
                    name="Last Verified"
                    value={shortDate(selectedCase.participation_last_verified_at)}
                  />
                  <Field
                    name="Next Verification Due"
                    value={shortDate(selectedNetworkParticipation?.next_verification_due_date)}
                  />
                </div>
              </section>

              <section className="thera-card">
                <h2>Record Verification</h2>
                {!selectedCase.enrollment_id ? (
                  <div className="thera-state">An enrollment is required before network verification can be recorded.</div>
                ) : (
                  <>
                    <div className="thera-form-grid">
                      <label>
                        Verification Method
                        <select
                          className="thera-input"
                          value={verificationForm.verification_method}
                          onChange={(event) =>
                            setVerificationForm({
                              ...verificationForm,
                              verification_method: event.target.value,
                            })
                          }
                        >
                          <option value="payer_portal">Payer Portal</option>
                          <option value="payer_phone">Payer Phone</option>
                          <option value="provider_directory">Provider Directory</option>
                          <option value="roster">Roster</option>
                          <option value="email">Email</option>
                          <option value="other">Other</option>
                        </select>
                      </label>
                      <label>
                        Participation Result
                        <select
                          className="thera-input"
                          value={verificationForm.result}
                          onChange={(event) =>
                            setVerificationForm({
                              ...verificationForm,
                              result: event.target.value,
                            })
                          }
                        >
                          <option value="participating">Participating</option>
                          <option value="pending">Pending</option>
                          <option value="non_participating">Non-participating</option>
                          <option value="suspended">Suspended</option>
                          <option value="terminated">Terminated</option>
                          <option value="unknown">Unknown</option>
                        </select>
                      </label>
                      <label>
                        Directory Status
                        <select
                          className="thera-input"
                          value={verificationForm.directory_status}
                          onChange={(event) =>
                            setVerificationForm({
                              ...verificationForm,
                              directory_status: event.target.value,
                            })
                          }
                        >
                          <option value="listed">Listed</option>
                          <option value="not_listed">Not Listed</option>
                          <option value="inaccurate">Inaccurate</option>
                          <option value="not_applicable">Not Applicable</option>
                          <option value="unknown">Unknown</option>
                        </select>
                      </label>
                      <label>
                        Reference #
                        <input
                          className="thera-input"
                          value={verificationForm.reference_number}
                          onChange={(event) =>
                            setVerificationForm({
                              ...verificationForm,
                              reference_number: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Representative
                        <input
                          className="thera-input"
                          value={verificationForm.representative_name}
                          onChange={(event) =>
                            setVerificationForm({
                              ...verificationForm,
                              representative_name: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Source URL
                        <input
                          className="thera-input"
                          type="url"
                          value={verificationForm.source_url}
                          onChange={(event) =>
                            setVerificationForm({
                              ...verificationForm,
                              source_url: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Next Verification Due
                        <input
                          className="thera-input"
                          type="date"
                          value={verificationForm.next_verification_due_date}
                          onChange={(event) =>
                            setVerificationForm({
                              ...verificationForm,
                              next_verification_due_date: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Evidence File
                        <input
                          className="thera-input"
                          type="file"
                          onChange={(event) =>
                            setVerificationEvidenceFile(event.target.files?.[0] ?? null)
                          }
                        />
                      </label>
                      <label style={{ gridColumn: "1 / -1" }}>
                        Notes
                        <textarea
                          className="thera-input"
                          rows={3}
                          value={verificationForm.notes}
                          onChange={(event) =>
                            setVerificationForm({
                              ...verificationForm,
                              notes: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="thera-filter-row" style={{ marginTop: 16 }}>
                      <button
                        type="button"
                        className="thera-action"
                        disabled={recordingVerification || !verificationForm.verification_method.trim()}
                        onClick={() => void recordNetworkVerification()}
                      >
                        {recordingVerification ? "Recording..." : "Record Verification"}
                      </button>
                    </div>
                  </>
                )}
              </section>

              <section className="thera-card">
                <h2>Verification History</h2>
                <div className="thera-table-wrap">
                  <table className="thera-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Method</th>
                        <th>Result</th>
                        <th>Reference</th>
                        <th>Representative</th>
                        <th>Source</th>
                        <th>Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedVerificationRows.length === 0 ? (
                        <tr><td colSpan={7}>No network verification history recorded.</td></tr>
                      ) : null}
                      {selectedVerificationRows.map((row) => {
                        const evidence = selectedCredentialingDocuments.filter(
                          (entry) => entry.link.verification_id === row.id,
                        );
                        return (
                          <tr key={row.id}>
                            <td>{shortDate(row.verified_at)}</td>
                            <td>{String(row.verification_method || "—").replaceAll("_", " ")}</td>
                            <td><StatusBadge value={row.result} /></td>
                            <td>{row.reference_number || "—"}</td>
                            <td>{row.representative_name || "—"}</td>
                            <td>
                              {row.source_url ? (
                                <a
                                  className="thera-link"
                                  href={row.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open source
                                </a>
                              ) : "—"}
                            </td>
                            <td>
                              {evidence.length
                                ? evidence.map((entry) => entry.document?.file_name || "Evidence").join(", ")
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : null}

          {drawerTab === "roster" ? (
            <div className="thera-stack">
              <section className="thera-card">
                <h2>Roster Management</h2>
                {!selectedCase.enrollment_id ? (
                  <div className="thera-state">
                    A payer enrollment is required before roster work can be created.
                  </div>
                ) : (
                  <>
                    <div className="thera-form-grid">
                      <label>
                        Roster Action
                        <select
                          className="thera-input"
                          value={rosterForm.action_type}
                          onChange={(event) =>
                            setRosterForm({ ...rosterForm, action_type: event.target.value })
                          }
                        >
                          {rosterActionTypes.map((type) => (
                            <option key={type} value={type}>
                              {type.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Priority
                        <select
                          className="thera-input"
                          value={rosterForm.priority}
                          onChange={(event) =>
                            setRosterForm({ ...rosterForm, priority: event.target.value })
                          }
                        >
                          <option value="low">Low</option>
                          <option value="normal">Normal</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      </label>
                      <label>
                        Due Date
                        <input
                          className="thera-input"
                          type="date"
                          value={rosterForm.due_date}
                          onChange={(event) =>
                            setRosterForm({ ...rosterForm, due_date: event.target.value })
                          }
                        />
                      </label>
                      <label style={{ gridColumn: "1 / -1" }}>
                        Requested Change
                        <textarea
                          className="thera-input"
                          rows={3}
                          placeholder="Describe the exact payer roster change."
                          value={rosterForm.requested_change}
                          onChange={(event) =>
                            setRosterForm({
                              ...rosterForm,
                              requested_change: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label style={{ gridColumn: "1 / -1" }}>
                        Notes
                        <textarea
                          className="thera-input"
                          rows={3}
                          value={rosterForm.notes}
                          onChange={(event) =>
                            setRosterForm({ ...rosterForm, notes: event.target.value })
                          }
                        />
                      </label>
                    </div>
                    <div className="thera-filter-row" style={{ marginTop: 16 }}>
                      <button
                        type="button"
                        className="thera-action"
                        disabled={creatingRosterAction}
                        onClick={() => void createRosterAction()}
                      >
                        {creatingRosterAction ? "Creating..." : "Create Roster Action"}
                      </button>
                    </div>
                  </>
                )}
              </section>

              <section className="thera-card">
                <h2>Roster Actions</h2>
                <div className="thera-table-wrap">
                  <table className="thera-table">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Status</th>
                        <th>Requested</th>
                        <th>Submitted</th>
                        <th>Confirmed</th>
                        <th>Reference</th>
                        <th>Work Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRosterActions.length === 0 ? (
                        <tr><td colSpan={8}>No roster actions for this enrollment.</td></tr>
                      ) : null}
                      {selectedRosterActions.map((action) => {
                        const work = workItems.find(
                          (row) =>
                            row.workqueue_type === "roster_action" &&
                            row.source_object_type === "roster_action" &&
                            row.source_object_id === action.id,
                        );
                        return (
                          <tr key={action.id}>
                            <td>{String(action.action_type || "—").replaceAll("_", " ")}</td>
                            <td><StatusBadge value={action.status} /></td>
                            <td>{shortDate(action.requested_date)}</td>
                            <td>{shortDate(action.submitted_date)}</td>
                            <td>{shortDate(action.confirmed_date)}</td>
                            <td>{action.reference_number || "—"}</td>
                            <td><StatusBadge value={work?.workqueue_status || "open"} /></td>
                            <td>
                              <button
                                type="button"
                                className="thera-action secondary"
                                onClick={() => manageRosterAction(action)}
                              >
                                Manage
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {selectedRosterAction ? (
                <section className="thera-card">
                  <h2>Update Roster Action</h2>
                  <div className="thera-form-grid">
                    <label>
                      Status
                      <select
                        className="thera-input"
                        value={rosterTransitionForm.status}
                        disabled={rosterTransitionOptions(String(selectedRosterAction.status)).length === 0}
                        onChange={(event) =>
                          setRosterTransitionForm({
                            ...rosterTransitionForm,
                            status: event.target.value,
                          })
                        }
                      >
                        {rosterTransitionOptions(String(selectedRosterAction.status)).length === 0 ? (
                          <option value={String(selectedRosterAction.status)}>
                            {String(selectedRosterAction.status).replaceAll("_", " ")}
                          </option>
                        ) : null}
                        {rosterTransitionOptions(String(selectedRosterAction.status)).map((status) => (
                          <option key={status} value={status}>
                            {status.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Payer Reference #
                      <input
                        className="thera-input"
                        value={rosterTransitionForm.reference_number}
                        onChange={(event) =>
                          setRosterTransitionForm({
                            ...rosterTransitionForm,
                            reference_number: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>
                      Status Note
                      <textarea
                        className="thera-input"
                        rows={3}
                        value={rosterTransitionForm.notes}
                        onChange={(event) =>
                          setRosterTransitionForm({
                            ...rosterTransitionForm,
                            notes: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="thera-filter-row" style={{ marginTop: 16 }}>
                    <button
                      type="button"
                      className="thera-action"
                      disabled={
                        updatingRosterAction ||
                        rosterTransitionOptions(String(selectedRosterAction.status)).length === 0
                      }
                      onClick={() => void updateRosterAction()}
                    >
                      {updatingRosterAction ? "Updating..." : "Update Roster Action"}
                    </button>
                    <button
                      type="button"
                      className="thera-action secondary"
                      onClick={() => {
                        setSelectedRosterActionId(null);
                        setRosterTransitionForm(emptyRosterTransitionForm());
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </section>
              ) : null}
            </div>
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
