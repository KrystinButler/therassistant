import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import {
  addEncounterDiagnosis,
  addEncounterServiceLine,
  updateEncounterServiceLine,
  removeEncounterServiceLine,
  saveClinicalNote,
  signEncounterNote,
} from "../clinical/repository";
import { buildPatientReviewCheckIn } from "../scheduling/patient-review-model";
import { treatmentPlanAlert } from "../treatment-plans/workflow";
import { ExternalSummaryPanel } from "../clinical/ExternalSummaryPanel";
import { FastChartingPanel } from "../clinical/FastChartingPanel";
import { SessionTimelinePanel } from "../clinical/SessionTimelinePanel";
import { createSmartPhrase, getFastChartingContext, getSmartPhrases } from "../clinical/fast-charting-repository";
import { clinicalNoteSimilarity, emptyStructuredSelections, expandSmartPhraseAtCursor, synthesizeStructuredNarrative, type PriorStructuredContext, type SmartPhrase, type StructuredSelections } from "../clinical/fast-charting";
import { forensicContextForCarryForward } from "../clinical/forensic-context";
import { psychedelicContextForCarryForward } from "../clinical/psychedelic-context";
import { Icd10SearchInput } from "../coding/Icd10SearchInput";
import { normalizedServiceLine, matchingServiceLineExists } from "./service-line-validation";
import { ProcedureCodeSearchInput } from "../coding/ProcedureCodeSearchInput";
import { PlaceOfServiceSearchInput } from "../coding/PlaceOfServiceSearchInput";
import {
  FUNDING_SOURCE_OPTIONS,
  billingPathForFundingSource,
  billingPathLabel,
  fundingSubtypeOptions,
  resolveEncounterFunding,
  type FundingSourceType,
} from "../billing/funding-source";
import {
  appendClinicalSource,
  buildClinicalSourceProvenance,
  buildJournalNoteInsert,
  buildPreVisitNoteInsert,
  latestSharedJournalEntry,
  withClinicalSourceImport,
} from "./clinical-source-context";
import { getEncounterDetail, updateEncounter } from "./repository";
import "./encounter-page.css";

type EncounterDetail = Awaited<ReturnType<typeof getEncounterDetail>>;
type ContextTab = "lastVisit" | "treatment" | "journal" | "documents";
const noteLayouts: Record<string, { title: string; sections: string[] }> = {
 psychotherapy: { title: "Psychotherapy Progress Note", sections: ["Session focus", "Interventions", "Patient response", "Progress toward goals", "Risk assessment", "Plan"] },
 assessment: { title: "Clinical Assessment", sections: ["Presenting concerns", "History", "Mental status", "Diagnostic assessment", "Risk / safety", "Recommendations"] },
 intake: { title: "Intake Note", sections: ["Chief concern", "History", "Psychosocial context", "Mental status", "Risk / safety", "Initial plan"] },
 crisis: { title: "Crisis Note", sections: ["Presenting crisis", "Safety assessment", "Immediate interventions", "Response", "Disposition", "Safety plan"] },
 case_management: { title: "Case Management Note", sections: ["Service need", "Care coordination", "Resources", "Response", "Follow-up"] },
 medication_management: { title: "Medication Management Note", sections: ["Symptoms", "Adherence", "Side effects", "Mental status", "Risk assessment", "Medication plan"] },
 other: { title: "Clinical Note", sections: ["Reason for visit", "Findings", "Intervention", "Response", "Plan"] },
};
function noteTypeForService(value: string): string {
 const service = value.toLowerCase();
 if (service.includes("crisis")) return "crisis";
 if (/medication|psychiatric/.test(service)) return "medication_management";
 if (/assessment|intake|evaluation/.test(service)) return "assessment";
 if (service.includes("case management")) return "case_management";
 return "psychotherapy";
}
function sessionMinutes(start: string, end: string): number | null {
 if (!start || !end) return null;
 const [sh, sm] = start.split(":").map(Number);
 const [eh, em] = end.split(":").map(Number);
 const minutes = eh * 60 + em - sh * 60 - sm;
 return Number.isFinite(minutes) && minutes > 0 && minutes <= 1440 ? minutes : null;
}

function personName(row?: Record<string, any> | null) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function defaultPos(location?: string | null) {
  return location === "telehealth" || location === "phone" ? "02" : "11";
}

function appointmentDuration(appointment?: Record<string, any> | null) {
  const start = new Date(String(appointment?.starts_at ?? "")).getTime();
  const end = new Date(String(appointment?.ends_at ?? "")).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function displayText(row: Record<string, any> | null | undefined, keys: string[], fallback = "—") {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

export function EncounterPage() {
  const [, params] = useRoute<{ id: string }>("/encounters/:id");
  const encounterId = params?.id ?? "";
  const [data, setData] = useState<EncounterDetail | null>(null);
  const [contextTab, setContextTab] = useState<ContextTab>("lastVisit");
  const [contextOpen, setContextOpen] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showPhraseMenu, setShowPhraseMenu] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const signatureRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteType, setNoteType] = useState("psychotherapy");
  const [psychStart, setPsychStart] = useState("");
  const [psychStop, setPsychStop] = useState("");
  const [goalAddressed, setGoalAddressed] = useState("");
  const [diagnosisCode, setDiagnosisCode] = useState("");
  const [diagnosisDescription, setDiagnosisDescription] = useState("");
  const [serviceCode, setServiceCode] = useState("");
  const [editingServiceLineId, setEditingServiceLineId] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [modifier1, setModifier1] = useState("");
  const [units, setUnits] = useState(1);
  const [chargeDollars, setChargeDollars] = useState("");
  const [placeOfService, setPlaceOfService] = useState("11");
  const [signatureText, setSignatureText] = useState("");
  const [fundingSourceType, setFundingSourceType] = useState<FundingSourceType>("insurance");
  const [fundingSourceSubtype, setFundingSourceSubtype] = useState("");
  const [fundingResponsibleEntity, setFundingResponsibleEntity] = useState("");
  const [fundingReference, setFundingReference] = useState("");
  const [fundingNotes, setFundingNotes] = useState("");
  const [smartPhrases, setSmartPhrases] = useState<SmartPhrase[]>([]);
  const [structuredSelections, setStructuredSelections] = useState<StructuredSelections>(() => emptyStructuredSelections());
  const [carryForwardContext, setCarryForwardContext] = useState<Record<string, unknown>>({});
  const [priorStructuredContext, setPriorStructuredContext] = useState<PriorStructuredContext | null>(null);

  async function load() {
    if (!encounterId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getEncounterDetail(encounterId);
      setData(result);
      const note = result.notes[0];
      const fastCharting = await getFastChartingContext(String(result.encounter.client_id ?? ""), encounterId, note?.id ? String(note.id) : undefined);
      setSmartPhrases(fastCharting.phrases);
      setStructuredSelections(fastCharting.current?.selections ?? emptyStructuredSelections());
      setCarryForwardContext(fastCharting.current?.carryForwardContext ?? {});
      setPriorStructuredContext(fastCharting.prior);
      setNoteText(String(note?.note_text ?? ""));
      setNoteType(String(note?.note_type ?? noteTypeForService(String(result.appointment?.service_type ?? result.encounter.service_type ?? ""))));
      setGoalAddressed(String(note?.goal_addressed ?? ""));
      const clientMetadata =
        result.client?.metadata && typeof result.client.metadata === "object"
          ? result.client.metadata as Record<string, unknown>
          : {};
      const funding = resolveEncounterFunding(
        result.encounter,
        String(clientMetadata.billing_type ?? "insurance"),
      );
      setFundingSourceType(funding.sourceType);
      setFundingSourceSubtype(funding.sourceSubtype);
      setFundingResponsibleEntity(String(funding.context.responsible_entity ?? ""));
      setFundingReference(String(funding.context.reference ?? ""));
      setFundingNotes(String(funding.context.notes ?? ""));
      setServiceCode((current) => current || String(result.appointment?.cpt_code ?? "90837"));
      setPlaceOfService(defaultPos(String(result.encounter.location_type ?? "")));
      setSignatureText((current) => {
        if (current || !result.provider) return current;
        const providerName = personName(result.provider);
        const credentials = String(result.provider.credentials ?? "").trim();
        return `${providerName}${credentials ? `, ${credentials}` : ""}`;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load encounter.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [encounterId]);

  useEffect(() => {
    if (loading || !data) return;
    const focusLinkedField = () => {
      const targetId = decodeURIComponent(window.location.hash.slice(1));
      if (!["encounter-progress-note-editor", "encounter-signature", "encounter-diagnoses", "encounter-coding-service", "encounter-session-time", "encounter-billing-source"].includes(targetId)) return;
      const target = document.getElementById(targetId);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      const control = target.matches("input,textarea,select") ? target as HTMLElement : target.querySelector<HTMLElement>("input:not(:disabled),textarea:not(:disabled),select:not(:disabled)");
      control?.focus({ preventScroll: true });
    };
    focusLinkedField();
    window.addEventListener("hashchange", focusLinkedField);
    return () => window.removeEventListener("hashchange", focusLinkedField);
  }, [loading, data]);

  const signed = useMemo(
    () => Boolean(data?.notes.some((note) => ["signed", "locked"].includes(String(note.note_status)))),
    [data],
  );
  const generatedNarrative = useMemo(() => synthesizeStructuredNarrative(structuredSelections), [structuredSelections]);
  const noteSimilarity = useMemo(
    () => clinicalNoteSimilarity(noteText, priorStructuredContext?.noteText ?? ""),
    [noteText, priorStructuredContext?.noteText],
  );

  async function withSave(
    action: () => Promise<unknown>,
    successMessage: string,
    preserveClinicalDraft = false,
    onFailure?: (message: string) => void,
  ) {
    const draft = preserveClinicalDraft
      ? {
          noteText,
          noteType,
          goalAddressed,
          structuredSelections,
          carryForwardContext,
        }
      : null;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(successMessage);
      await load();
      if (draft) {
        setNoteText(draft.noteText);
        setNoteType(draft.noteType);
        setGoalAddressed(draft.goalAddressed);
        setStructuredSelections(draft.structuredSelections);
        setCarryForwardContext(draft.carryForwardContext);
      }
      return true;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unable to save encounter changes.";
      setError(reason);
      onFailure?.(reason);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    await withSave(
      () => saveClinicalNote(encounterId, { noteType, noteText, goalAddressed, structuredSelections, generatedNarrative, carryForwardContext }),
      "Clinical note saved and marked ready for signature.",
    );
  }

  async function addDiagnosis() {
    await withSave(
      () => addEncounterDiagnosis(encounterId, {
        diagnosisCode,
        diagnosisDescription,
        isPrimary: (data?.diagnoses.length ?? 0) === 0,
      }),
      "Diagnosis added to encounter.",
      true,
    );
    setDiagnosisCode("");
    setDiagnosisDescription("");
  }

  function editServiceLine(line: EncounterDetail["serviceLines"][number]) {
    setEditingServiceLineId(String(line.id));
    setServiceError(null);
    setServiceCode(String(line.cpt_hcpcs_code ?? ""));
    setModifier1(String(line.modifier1 ?? ""));
    setUnits(Number(line.units ?? 1));
    setChargeDollars((Number(line.charge_amount_cents ?? 0) / 100).toFixed(2));
    setPlaceOfService(String(line.place_of_service_code ?? "11"));
    document.getElementById("encounter-service-editor")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function resetServiceEditor() {
    setEditingServiceLineId(null);
    setServiceError(null);
    setModifier1("");
    setUnits(1);
    setChargeDollars("");
  }
  async function addServiceLine() {
    setServiceError(null);
    let values;
    try {
      values = normalizedServiceLine({ cptCode: serviceCode, modifier1, units, chargeDollars, placeOfService });
      if (!editingServiceLineId && matchingServiceLineExists(data?.serviceLines ?? [], values)) {
        throw new Error("This encounter already has that procedure, modifier and place of service. Edit the existing line instead of adding a duplicate.");
      }
    } catch (err) {
      setServiceError(err instanceof Error ? err.message : "Review service-line details.");
      return;
    }
    const success = await withSave(
      () => editingServiceLineId
        ? updateEncounterServiceLine(encounterId, editingServiceLineId, values)
        : addEncounterServiceLine(encounterId, values),
      editingServiceLineId ? "Unbilled service line updated." : "Unbilled service line added.",
      true,
      setServiceError,
    );
    if (success) resetServiceEditor();
  }
  async function removeServiceLine(lineId: string) {
    if (!window.confirm("Remove this unbilled service line? This cannot be undone.")) return;
    const success = await withSave(
      () => removeEncounterServiceLine(encounterId, lineId),
      "Unbilled service line removed.",
      true,
      setServiceError,
    );
    if (success && editingServiceLineId === lineId) resetServiceEditor();
  }

  async function saveFundingPath() {
    const billingPath = billingPathForFundingSource(fundingSourceType);
    await withSave(
      () => updateEncounter(encounterId, {
        funding_source_type: fundingSourceType,
        funding_source_subtype: fundingSourceSubtype || null,
        billing_path: billingPath,
        funding_context: {
          responsible_entity: fundingResponsibleEntity.trim() || null,
          reference: fundingReference.trim() || null,
          notes: fundingNotes.trim() || null,
        },
      }),
      `Funding source saved. New billing routing: ${billingPathLabel(billingPath)}.`,
      true,
    );
  }

  async function sign() {
    if (saving || signed) return;
    if (!noteText.trim()) {
      setError("Enter clinical documentation in the note editor before signing.");
      noteRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      noteRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!signatureText.trim()) {
      setError("Enter the rendering provider's signature before signing.");
      signatureRef.current?.focus();
      return;
    }
    if (!data?.encounter.provider_id) {
      setError("This encounter has no rendering provider. Assign a provider before signing.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const providerId = String(data?.encounter.provider_id ?? "");
      const saved = await saveClinicalNote(encounterId, { noteType, noteText, goalAddressed, structuredSelections, generatedNarrative, carryForwardContext });
      const result = await signEncounterNote(encounterId, providerId, signatureText);
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setData((current) => current ? { ...current,
        notes: [{ ...saved, note_status: "signed", locked_at: result.value.signedAt }, ...current.notes.filter((row) => row.id !== saved.id)],
      } : current);
      setMessage("Clinical note signed and locked. Billing exceptions remain outside the clinical workflow.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign note.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <div className="thera-state">Loading encounter...</div>;
  if (error && !data) return <div className="thera-state error">{error}</div>;
  if (!data) return <div className="thera-state error">Encounter not found.</div>;

  const encounter = data.encounter;
  const serviceDate = String(encounter.started_at ?? "").slice(0, 10);
  const note = data.notes[0];
  const currentTreatmentPlan = data.treatmentPlans.find((plan) =>
    ["active", "signed"].includes(String(plan.status ?? "")),
  ) ?? data.treatmentPlans[0] ?? null;
  const activeGoals = currentTreatmentPlan
    ? data.treatmentPlanGoals.filter((goal) => goal.treatment_plan_id === currentTreatmentPlan.id)
    : [];
  const activeGoal = activeGoals[0] ?? null;
  const treatmentPlanReadiness = currentTreatmentPlan
    ? treatmentPlanAlert(
        {
          status: String(currentTreatmentPlan.status ?? "draft"),
          reviewDueDate: currentTreatmentPlan.review_due_date
            ? String(currentTreatmentPlan.review_due_date)
            : null,
        },
        new Date(String(encounter.started_at ?? new Date().toISOString())),
      )
    : null;

  const currentCheckin = data.checkins.find(
    (row) => String(row.appointment_id ?? "") === String(encounter.appointment_id ?? ""),
  ) ?? null;
  const preVisit = buildPatientReviewCheckIn(currentCheckin);
  const preVisitInsert = buildPreVisitNoteInsert(preVisit);
  const sharedJournal = latestSharedJournalEntry(data.journalEntries);
  const journalInsert = buildJournalNoteInsert(sharedJournal);
  const duration = appointmentDuration(data.appointment);
  const activeGoalText = displayText(activeGoal, ["goal_text", "description", "goal", "title"], "");
  const noteLayout = noteLayouts[noteType] ?? noteLayouts.other;
  const noteWordCount = noteText.trim() ? noteText.trim().split(/\s+/).length : 0;
  const noteHasUnsavedText = noteText !== String(note?.note_text ?? "");
  const calculatedMinutes = sessionMinutes(psychStart, psychStop);
  function updateSessionTime(start: string, stop: string) {
    setPsychStart(start); setPsychStop(stop);
    setStructuredSelections((current) => ({ ...current, psychotherapyMinutes: sessionMinutes(start, stop) }));
  }
  function changeNoteType(value: string) {
    setNoteType(value);
    if (["assessment", "intake", "psychotherapy"].includes(value)) setStructuredSelections((current) => ({ ...current, templateType: value === "psychotherapy" ? "standard_therapy" : "intake" }));
  }
  const visitFocus = preVisit.focus || goalAddressed || activeGoalText || "No patient focus was submitted for this visit.";

  const completionChecks = [
    {
      label: "Clinical note",
      status: noteText.trim() ? "pass" : "attention",
      detail: noteText.trim() ? "Documentation entered." : "Clinical documentation is still empty.",
    },
    {
      label: "Diagnosis",
      status: data.diagnoses.length ? "pass" : "attention",
      detail: data.diagnoses.length ? `${data.diagnoses.length} diagnosis record(s) connected.` : "No encounter diagnosis is saved yet.",
    },
    {
      label: "Coding / service",
      status: data.serviceLines.length ? "pass" : "attention",
      detail: data.serviceLines.length ? `${data.serviceLines.length} service line(s) connected.` : "No service line is saved yet.",
    },
    {
      label: "Documented time",
      status: duration > 0 ? "pass" : "attention",
      detail: duration > 0 ? `${duration} scheduled minutes available for review.` : "Visit duration is not available from the appointment.",
    },
  ] as const;
  const billingFollowUpCount = completionChecks.filter((check) => check.status !== "pass").length;

  function handleNoteChange(value: string, cursor: number) {
    const expansion = expandSmartPhraseAtCursor(value, cursor, smartPhrases);
    if (expansion) {
      setNoteText(expansion.value);
      setShowSlashMenu(false);
      requestAnimationFrame(() => {
        const textarea = noteRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(expansion.cursor, expansion.cursor);
      });
      return;
    }
    setNoteText(value);
    if (structuredSelections.similarityReviewAcknowledged) {
      setStructuredSelections((current) => ({ ...current, similarityReviewAcknowledged: false }));
    }
    setShowSlashMenu(value.endsWith("/"));
  }

  function insertNoteSection(section: string) {
    if (signed) return;
    injectIntoNote(`${noteText.trim() ? "\n\n" : ""}${section}:\n`);
  }

  function insertEditorPhrase(content: string) {
    if (signed) return;
    injectIntoNote(content);
    setShowPhraseMenu(false);
  }

  function injectQuickText(text: string) {
    const textarea = noteRef.current;
    const start = textarea?.selectionStart ?? noteText.length;
    const slashStart = noteText.slice(0, start).lastIndexOf("/");
    const insertAt = slashStart >= 0 ? slashStart : start;
    const end = textarea?.selectionEnd ?? start;
    setNoteText((current) => `${current.slice(0, insertAt)}${text}${current.slice(end)}`);
    setShowSlashMenu(false);
    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      const cursor = insertAt + text.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function injectIntoNote(text: string) {
    if (signed || !text.trim()) return;
    const textarea = noteRef.current;
    const start = textarea?.selectionStart ?? noteText.length;
    const end = textarea?.selectionEnd ?? noteText.length;
    setNoteText((current) => `${current.slice(0, start)}${text}${current.slice(end)}`);
    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      const cursor = start + text.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function importPreVisit() {
    if (signed || !preVisitInsert) return;
    setNoteText((current) => appendClinicalSource(current, preVisitInsert));
    setCarryForwardContext((current) =>
      withClinicalSourceImport(
        current,
        buildClinicalSourceProvenance("pre_visit_checkin", currentCheckin),
      ),
    );
    if (!goalAddressed.trim() && preVisit.treatmentGoal) {
      setGoalAddressed(preVisit.treatmentGoal);
    }
    setMessage("Patient-reported check-in content was inserted with source provenance for provider review. It remains editable until signature.");
  }

  function importJournal() {
    if (signed || !journalInsert) return;
    setNoteText((current) => appendClinicalSource(current, journalInsert));
    setCarryForwardContext((current) =>
      withClinicalSourceImport(
        current,
        buildClinicalSourceProvenance("journal_entry", sharedJournal),
      ),
    );
    setMessage("Patient-shared journal content was inserted with source provenance for provider review. It remains editable until signature.");
  }

  async function addSmartPhrase(input: { shortcut: string; label: string; content: string; scope: "user" | "practice" }) {
    await createSmartPhrase(input);
    setSmartPhrases(await getSmartPhrases());
    setMessage("SmartPhrase saved.");
  }

  function carryForwardStructured() {
    if (signed || !priorStructuredContext) return;
    setStructuredSelections({
      ...priorStructuredContext.selections,
      forensicContext: forensicContextForCarryForward(priorStructuredContext.selections.forensicContext),
      psychedelicContext: psychedelicContextForCarryForward(priorStructuredContext.selections.psychedelicContext),
      timelineEvents: [],
      psychotherapyMinutes: null,
      similarityReviewAcknowledged: false,
    });
    if (!goalAddressed.trim() && priorStructuredContext.goalAddressed) setGoalAddressed(priorStructuredContext.goalAddressed);
    setCarryForwardContext({
      source_note_id: priorStructuredContext.noteId,
      source_service_date: priorStructuredContext.serviceDate,
      copied_fields: ["structured_selections", "goal_addressed"],
    });
    setMessage("Structured clinical context carried forward. Prior narrative text was not copied.");
  }

  return (
    <>
      <div className="thera-breadcrumb">
        <Link href="/schedule" className="thera-link">Schedule</Link>
        <span>/</span>
        <Link href={`/clients/${String(encounter.client_id)}`} className="thera-link">{personName(data.client)}</Link>
        <span>/</span>
        <span>Encounter</span>
      </div>

      <div className="thera-page-header split encounter-page-header">
        <div>
          <div className="thera-eyebrow">DOCUMENT · LIVE ENCOUNTER</div>
          <h1>{personName(data.client)}</h1>
          <p>{personName(data.provider)} · {String(encounter.service_type ?? "Clinical Service")} · Started {dateTime(String(encounter.started_at ?? ""))}</p>
        </div>
        <div className="thera-header-badges">
          <StatusBadge value={String(encounter.encounter_status ?? "in_progress")} />
          <StatusBadge value={String(encounter.billing_status ?? "not_ready")} />
        </div>
      </div>

      <section className="encounter-focus-banner">
        <div>
          <div className="thera-eyebrow">TODAY&apos;S FOCUS</div>
          <strong>{visitFocus}</strong>
          <span>{preVisit.hasSubmittedPreVisit ? "Patient-reported focus from pre-visit check-in" : activeGoalText ? "Active treatment-plan context" : "Provider-defined visit context"}</span>
        </div>
        <div className="encounter-focus-goal">
          <span>Active Goal</span>
          <strong>{activeGoalText || "No active goal documented"}</strong>
        </div>
      </section>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="encounter-console">
        <section className="thera-card encounter-note-card">
          <div className="thera-card-header">
            <div><div className="thera-eyebrow">DOCUMENT</div><h2>Active Progress Note</h2><p>Keep documentation open while reviewing clinical context.</p></div>
            {note && <StatusBadge value={String(note.note_status)} />}
          </div>
          <div className="encounter-note-controls">
            {noteType === "psychotherapy" && <div className="encounter-session-time" id="encounter-session-time"><label>Psychotherapy start<input type="time" className="thera-input" value={psychStart} disabled={signed} onChange={(event) => updateSessionTime(event.target.value, psychStop)} /></label><label>Psychotherapy stop<input type="time" className="thera-input" value={psychStop} disabled={signed} onChange={(event) => updateSessionTime(psychStart, event.target.value)} /></label><span aria-live="polite">Actual psychotherapy: {calculatedMinutes === null ? "Enter start and stop" : calculatedMinutes + " minutes (calculated)"}</span></div>}
            <label><div className="thera-field-label">Note Type</div><select className="thera-input" value={noteType} disabled={signed} onChange={(event) => changeNoteType(event.target.value)}><option value="psychotherapy">Psychotherapy</option><option value="assessment">Assessment</option><option value="intake">Intake</option><option value="crisis">Crisis</option><option value="case_management">Case Management</option><option value="medication_management">Medication Management</option><option value="other">Other</option></select></label>
            <label><div className="thera-field-label">Treatment Plan — Goal / Objective</div><select className="thera-input" value={goalAddressed} disabled={signed} onChange={(event) => setGoalAddressed(event.target.value)}><option value="">Select a goal</option>{activeGoals.map((goal) => { const label = displayText(goal, ["goal_text", "description", "goal", "title"], "Goal"); return <option key={goal.id} value={label}>{label}</option>; })}{goalAddressed && !activeGoals.some((goal) => displayText(goal, ["goal_text", "description", "goal", "title"], "Goal") === goalAddressed) && <option value={goalAddressed}>{goalAddressed} (previous selection)</option>}</select>{activeGoals.length === 0 && <small>No linked treatment-plan goals. Add a goal in the patient's treatment plan.</small>}</label>
          </div>
          <SessionTimelinePanel signed={signed} selections={structuredSelections} onSelectionsChange={setStructuredSelections} onInsertPhrase={injectIntoNote} />
          <div className="encounter-editor-surface">
            <div className="encounter-editor-heading">
              <div><div className="thera-eyebrow">CLINICAL DOCUMENTATION</div><label htmlFor="encounter-progress-note-editor">{noteLayout.title}</label></div>
              <span className={signed ? "encounter-editor-status signed" : noteHasUnsavedText ? "encounter-editor-status unsaved" : "encounter-editor-status"}>
                {signed ? "Signed · Read only" : noteHasUnsavedText ? "Unsaved changes" : "Draft"}
              </span>
            </div>
            <div className="encounter-editor-toolbar" role="toolbar" aria-label="Progress note writing tools">
              <div className="encounter-section-tools">
                <span className="encounter-tool-label">Insert section</span>
                <div className="encounter-section-buttons">
                  {noteLayout.sections.map((section) => <button type="button" key={section} className="encounter-insert-chip" disabled={signed} onClick={() => insertNoteSection(section)} title={`Insert ${section} heading at the cursor`}>{section}</button>)}
                </div>
              </div>
              <div className="encounter-phrase-control">
                <button type="button" className="encounter-phrase-trigger" disabled={signed} aria-expanded={showPhraseMenu} aria-controls="encounter-smartphrase-quick-menu" onClick={() => setShowPhraseMenu((open) => !open)}>
                  SmartPhrases <span>{smartPhrases.length}</span> <span aria-hidden="true">▾</span>
                </button>
                {showPhraseMenu && !signed && <div id="encounter-smartphrase-quick-menu" className="encounter-phrase-menu" role="group" aria-label="Insert a SmartPhrase">
                  <div className="encounter-phrase-menu-heading">Insert at cursor</div>
                  {smartPhrases.length ? smartPhrases.map((phrase) => <button type="button" key={phrase.id} title={phrase.label} onClick={() => insertEditorPhrase(phrase.content)}><strong>{phrase.label}</strong><span>{phrase.shortcut}</span></button>) : <p>No SmartPhrases available. Create one in the library below.</p>}
                </div>}
              </div>
            </div>
            <div className="encounter-editor-wrap">
              <textarea id="encounter-progress-note-editor" ref={noteRef} className="thera-input encounter-note-editor" value={noteText} disabled={signed} aria-describedby="encounter-progress-note-hint" onChange={(event) => handleNoteChange(event.target.value, event.target.selectionStart)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (!saving && !signed && noteText.trim()) void saveNote(); } }} placeholder={`Document the ${noteLayout.title.toLowerCase()} here. Use Insert section to structure your note.`} spellCheck />
              {showSlashMenu && !signed && <div className="encounter-slash-menu"><div>QUICK INSERTS</div><button type="button" onClick={() => injectQuickText("Risk Assessment: Client denies suicidal or homicidal ideation. No acute safety concerns reported.")}>Risk: Standard Negative</button><button type="button" onClick={() => injectQuickText("Mental Status: Alert and oriented x4. Appearance and behavior appropriate. Speech normal. Thought process linear and goal directed.")}>MSE: Within Normal Limits</button><button type="button" onClick={() => injectQuickText("Intervention: Supportive psychotherapy, reflective listening, validation, and collaborative problem solving were utilized.")}>Intervention: Supportive</button></div>}
            </div>
            <div className="encounter-editor-footer">
              <div id="encounter-progress-note-hint" className="encounter-editor-meta"><strong>{noteWordCount} words</strong><span aria-hidden="true">·</span><span>Type / for quick inserts</span><span aria-hidden="true">·</span><span>{signed ? "Signed note is locked" : "Save to keep your draft"}</span></div>
              {!signed && <button type="button" className="thera-action encounter-editor-save" disabled={saving || !noteText.trim()} onClick={() => void saveNote()}>{saving ? "Saving..." : "Save Note"}</button>}
            </div>
          </div>
          <FastChartingPanel signed={signed} phrases={smartPhrases} selections={structuredSelections} generatedNarrative={generatedNarrative} priorContext={priorStructuredContext} noteSimilarity={noteSimilarity} onSelectionsChange={setStructuredSelections} onInsertNarrative={() => injectIntoNote("\n" + generatedNarrative + "\n")} onInsertPhrase={injectIntoNote} onCarryForward={carryForwardStructured} onCreatePhrase={addSmartPhrase} />
          
          {signed && data.signatures[0] && <div className="thera-alert" style={{ marginTop: 12 }}>Signed {dateTime(String(data.signatures[0].signed_at ?? ""))} by {String(data.signatures[0].signature_text ?? "provider")}</div>}
        </section>
        <aside className={contextOpen ? "encounter-context-rail open" : "encounter-context-rail"}>
          <div className="encounter-context-tabs" role="tablist" aria-label="Clinical context">
            <ContextButton active={contextTab === "lastVisit"} label="Last Visit" short="LV" onClick={() => { setContextTab("lastVisit"); setContextOpen(true); }} />
            <ContextButton active={contextTab === "treatment"} label="Treatment Plan" short="TP" onClick={() => { setContextTab("treatment"); setContextOpen(true); }} />
            <ContextButton active={contextTab === "journal"} label="Journal" short="JR" onClick={() => { setContextTab("journal"); setContextOpen(true); }} />
            <ContextButton active={contextTab === "documents"} label="Documents" short="DC" onClick={() => { setContextTab("documents"); setContextOpen(true); }} />
            <button type="button" className="encounter-context-collapse" onClick={() => setContextOpen((open) => !open)} aria-label={contextOpen ? "Collapse clinical context" : "Expand clinical context"}>{contextOpen ? "›" : "‹"}</button>
          </div>
          {contextOpen && <div className="encounter-context-content">
            {contextTab === "lastVisit" && <><div className="encounter-context-heading"><div><span>LAST VISIT</span><h3>Prior Session Context</h3></div></div><div className="encounter-context-section"><Field label="Current visit focus" value={visitFocus} /><Field label="Goal / objective" value={goalAddressed || activeGoalText || "—"} />{preVisit.hasSubmittedPreVisit && <div className="encounter-context-source"><strong>Pre-Visit Check-In</strong>{preVisit.focus && <p>{preVisit.focus}</p>}{preVisit.mood && <small>Since last visit: {preVisit.mood}</small>}{!signed && preVisitInsert && <button type="button" className="thera-action secondary" onClick={importPreVisit}>Cite Check-In</button>}</div>}<div className="encounter-context-source"><strong>Previous clinical note</strong><p>{data.notes.length > 1 ? String(data.notes[1]?.note_text ?? "No prior note text available.") : "No earlier signed note is available in this encounter record."}</p></div></div></>}
            {contextTab === "treatment" && <><div className="encounter-context-heading"><div><span>GOLDEN THREAD</span><h3>Treatment Plan</h3></div>{treatmentPlanReadiness && <StatusBadge value={treatmentPlanReadiness.code} />}</div><div className="encounter-context-section">{activeGoals.length ? activeGoals.map((goal) => { const goalText = displayText(goal, ["goal_text", "description", "goal", "title"], "Goal"); return <div className="encounter-context-goal" key={goal.id}><div><strong>{goalText}</strong><small>{String(goal.goal_status ?? goal.status ?? "active").replaceAll("_", " ")}</small></div>{!signed && <button type="button" onClick={() => injectIntoNote(`\nProgress regarding treatment goal: ${goalText}\nIntervention: \nPatient response/progress: \n`)}>Cite →</button>}</div>; }) : <div className="thera-empty">No active treatment-plan goals are linked.</div>}</div></>}
            {contextTab === "journal" && <><div className="encounter-context-heading"><div><span>PATIENT CONTEXT</span><h3>Journal</h3></div></div><div className="encounter-context-section">{sharedJournal ? <div className="encounter-context-source"><Field label="Entry Date" value={shortDate(String(sharedJournal.entry_date ?? sharedJournal.created_at ?? ""))} /><p>{String(sharedJournal.entry_text ?? "")}</p>{!signed && journalInsert && <button type="button" className="thera-action secondary" onClick={importJournal}>Cite Journal</button>}</div> : <div className="thera-empty">No journal entry is shared with the provider.</div>}</div></>}
            {contextTab === "documents" && <><div className="encounter-context-heading"><div><span>CHART CONTEXT</span><h3>Documents</h3></div></div><div className="encounter-context-section">{data.documents.length ? data.documents.slice(0,12).map((document) => <div className="encounter-document-row" key={document.id}><div><strong>{String(document.file_name ?? "Document")}</strong><small>{String(document.document_type ?? "other").replaceAll("_", " ")} · {shortDate(String(document.created_at ?? ""))}</small></div><StatusBadge value={String(document.document_status ?? "uploaded")} /></div>) : <div className="thera-empty">No patient documents are indexed.</div>}<Link href={`/clients/${String(encounter.client_id)}`} className="thera-action secondary">Open Patient Documents</Link></div></>}
          </div>}
        </aside>
      </div>

      <div className="encounter-lower-grid">
        <section className="thera-card thera-span-2" id="encounter-billing-source">
          <div className="thera-card-header">
            <div>
              <div className="thera-eyebrow">OPTIONAL BILLING SETTINGS</div>
              <h2>Billing Responsibility</h2>
              <p>Set who is financially responsible for this encounter. This routing is separate from the signed clinical note and never starts a claim by itself.</p>
            </div>
            <StatusBadge value={String(encounter.billing_path ?? billingPathForFundingSource(fundingSourceType))} />
          </div>
          <div className="thera-form-grid">
            <label>
              Funding source
              <select className="thera-input" value={fundingSourceType} onChange={(event) => { setFundingSourceType(event.target.value as FundingSourceType); setFundingSourceSubtype(""); }}>
                {FUNDING_SOURCE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label>
              Funding subtype
              <select className="thera-input" value={fundingSourceSubtype} onChange={(event) => setFundingSourceSubtype(event.target.value)}>
                <option value="">Not specified</option>
                {fundingSubtypeOptions(fundingSourceType).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <div>
              <div className="thera-field-label">Billing path</div>
              <div className="thera-field-value">{billingPathLabel(billingPathForFundingSource(fundingSourceType))}</div>
              <div className="thera-table-subtext">Insurance creates claim-ready charges only after billing validation. Program funding is kept out of CMS-1500/837P claim creation. Private pay routes to patient/private responsibility.</div>
            </div>
            {fundingSourceType === "insurance" ? (
              <div>
                <div className="thera-field-label">Current payer</div>
                <div className="thera-field-value">{String(data.payer?.name ?? "No payer selected")}</div>
                <div className="thera-table-subtext">{String(data.plan?.name ?? data.policy?.member_id ?? "")}</div>
              </div>
            ) : (
              <label>
                Responsible entity / party
                <input className="thera-input" value={fundingResponsibleEntity} onChange={(event) => setFundingResponsibleEntity(event.target.value)} placeholder={fundingSourceType === "government_program" ? "Agency, court, program, or contractor" : "Patient, family member, attorney, or law firm"} />
              </label>
            )}
            {fundingSourceType !== "insurance" && <label>
              Contract / voucher / reference
              <input className="thera-input" value={fundingReference} onChange={(event) => setFundingReference(event.target.value)} />
            </label>}
            <label style={{ gridColumn: "1 / -1" }}>
              Funding notes
              <input className="thera-input" value={fundingNotes} onChange={(event) => setFundingNotes(event.target.value)} placeholder="Optional billing-routing context; do not place clinical narrative here." />
            </label>
          </div>
          <div className="thera-filter-row" style={{ marginTop: 10, justifyContent: "space-between", alignItems: "center" }}>
            <span className="thera-table-subtext">Saving a funding path affects future charge routing only; it does not silently rewrite an existing charge, claim, code, or signed note.</span>
            <button type="button" className="thera-action" disabled={saving} onClick={() => void saveFundingPath()}>Save Funding Path</button>
          </div>
        </section>
        <section className="thera-card" id="encounter-diagnoses"><div className="thera-card-header"><div><div className="thera-eyebrow">CLINICAL CONTEXT</div><h2>Diagnoses</h2></div></div>{data.diagnoses.length > 0 && <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Code</th><th>Description</th><th>Primary</th></tr></thead><tbody>{data.diagnoses.map((diagnosis) => <tr key={diagnosis.id}><td><strong>{String(diagnosis.diagnosis_code)}</strong></td><td>{String(diagnosis.diagnosis_description ?? "—")}</td><td>{diagnosis.is_primary ? "Yes" : "No"}</td></tr>)}</tbody></table></div>}{!signed && <div className="encounter-compact-form"><Icd10SearchInput code={diagnosisCode} description={diagnosisDescription} serviceDate={serviceDate} onSelect={(result) => { setDiagnosisCode(result.code); if (result.name) setDiagnosisDescription(result.name); }} /><input className="thera-input" placeholder="Diagnosis description" value={diagnosisDescription} onChange={(event) => setDiagnosisDescription(event.target.value)} /><button type="button" className="thera-action secondary" disabled={saving || !diagnosisCode.trim()} onClick={() => void addDiagnosis()}>+ Add Diagnosis</button></div>}</section>
        <section className="thera-card" id="encounter-coding-service">
          <div className="thera-card-header"><div><div className="thera-eyebrow">CODE</div><h2>Coding & Service</h2></div></div>
          <div className="encounter-coding-summary">
            <Field label="Scheduled Time" value={duration ? `${duration} minutes` : "Not available"} />
            <Field label="Visit Location" value={String(encounter.location_type ?? "—").replaceAll("_", " ")} />
            <Field label="Current POS" value={placeOfService || "—"} />
            <Field label="Payer" value={String(data.payer?.name ?? "—")} />
          </div>
          <div className="encounter-saved-services">
            <div className="thera-card-header"><div><h3>Recorded service lines ({data.serviceLines.length})</h3><p>Review existing lines before creating another. Unbilled lines can be corrected here.</p></div></div>
            {data.serviceLines.length ? <div className="thera-table-wrap"><table className="thera-table">
              <thead><tr><th>CPT / HCPCS</th><th>Modifier</th><th>Units</th><th>POS</th><th>Charge</th>{!signed && <th>Actions</th>}</tr></thead>
              <tbody>{data.serviceLines.map((line) => <tr key={String(line.id)}>
                <td><strong>{String(line.cpt_hcpcs_code ?? "—")}</strong></td><td>{String(line.modifier1 ?? "—")}</td>
                <td>{String(line.units ?? 1)}</td><td>{String(line.place_of_service_code ?? "—")}</td>
                <td>{Number(line.charge_amount_cents ?? 0) > 0 ? money(Number(line.charge_amount_cents)) : <span className="encounter-service-warning">Missing charge</span>}</td>
                {!signed && <td><div className="thera-filter-row">
                  <button type="button" className="thera-action secondary" disabled={saving} onClick={() => editServiceLine(line)}>Edit</button>
                  <button type="button" className="thera-action secondary" disabled={saving} onClick={() => void removeServiceLine(String(line.id))}>Remove</button>
                </div></td>}
              </tr>)}</tbody>
            </table></div> : <div className="thera-empty">No service lines recorded for this visit.</div>}
          </div>
          {!signed && <div className="encounter-service-editor" id="encounter-service-editor">
            <div className="thera-card-header split"><div><h3>{editingServiceLineId ? "Edit service line" : "Add service line"}</h3><p>Enter the code, units, place of service and a charge greater than $0.</p></div>
              {editingServiceLineId && <button className="thera-action secondary" type="button" disabled={saving} onClick={resetServiceEditor}>Cancel edit</button>}
            </div>
            <div className="encounter-service-form">
              <label>Procedure code <ProcedureCodeSearchInput code={serviceCode} serviceDate={serviceDate} onSelect={(result) => setServiceCode(result.code)} /></label>
              <label>Modifier (optional) <input className="thera-input" maxLength={2} placeholder="e.g., 95" value={modifier1} onChange={(event) => setModifier1(event.target.value.toUpperCase())} /></label>
              <label>Units <input aria-label="Service units" className="thera-input" type="number" min={1} step={1} value={units} onChange={(event) => setUnits(Number(event.target.value))} /></label>
              <label>Place of service <PlaceOfServiceSearchInput code={placeOfService} onSelect={(result) => setPlaceOfService(result.code)} /></label>
              <label>Charge ($) <input aria-label="Service charge" className="thera-input" type="number" step="0.01" min="0.01" placeholder="0.00" value={chargeDollars} onChange={(event) => setChargeDollars(event.target.value)} /></label>
              <div className="encounter-service-submit"><button type="button" className="thera-action" disabled={saving} onClick={() => void addServiceLine()}>
                {saving ? "Saving…" : editingServiceLineId ? "Save Service Line" : "+ Add Service Line"}
              </button></div>
            </div>
            {serviceError && <div className="thera-state error" role="alert" style={{ marginTop: 9 }}>{serviceError}</div>}
          </div>}
        </section>
        <section className="thera-card thera-span-2 encounter-sign-card" id="encounter-signature"><div className="thera-card-header"><div><div className="thera-eyebrow">REVIEW → SIGN</div><h2>Documentation Readiness & Signature</h2><p>Billing follow-up never prevents completion of the clinical record.</p></div><StatusBadge value={billingFollowUpCount ? "billing_follow_up" : "ready"} /></div><div className="encounter-readiness-grid">{completionChecks.map((check) => <div className="encounter-readiness-item" key={check.label}><StatusBadge value={check.status} /><div><strong>{check.label}</strong><span>{check.detail}</span></div></div>)}</div><div className="encounter-nonblocking-note">{billingFollowUpCount ? `${billingFollowUpCount} item(s) still need billing/coding follow-up. You may still sign the clinical note; THERASSISTANT will route those issues outside the clinical workflow.` : "The clinical record and current billing details are ready for handoff."}</div>{signed ? <div className="encounter-signed-handoff"><div><strong>Signed clinical record → Charge Capture</strong><span>The note is locked. Billing/coding corrections can continue without changing provider documentation.</span></div><Link href="/billing/charges" className="thera-action">Open Charge Capture</Link></div> : <div className="encounter-sign-block">
          <div className="encounter-sign-guidance" aria-live="polite">
            {!noteText.trim() ? <><strong>Clinical note required</strong><span>Write the visit note before signing. Billing information is not required.</span>
              <button type="button" className="thera-action secondary" onClick={() => { noteRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); noteRef.current?.focus({ preventScroll: true }); }}>Go to Note Editor ↑</button></>
              : !signatureText.trim() ? <><strong>Add your signature</strong><span>The note is ready; enter the rendering provider's signature.</span></>
              : <><strong>Ready to sign</strong><span>Sign & Lock will save your latest note text and lock the clinical record. Billing review happens afterward.</span></>}
          </div>
          <div className="encounter-sign-row"><label><div className="thera-field-label">Rendering Provider Signature</div><input ref={signatureRef} className="thera-input" value={signatureText} onChange={(event) => setSignatureText(event.target.value)} placeholder="Provider signature" /></label>
            <button type="button" className="thera-action" disabled={saving} onClick={() => void sign()}>{saving ? "Signing…" : "Sign & Lock Note"}</button>
          </div>
        </div>}</section>
        {signed && <ExternalSummaryPanel input={{
          patientName: personName(data.client),
          providerName: personName(data.provider),
          serviceDate,
          serviceType: String(encounter.service_type ?? data.appointment?.service_type ?? "Clinical Service"),
          attendanceStatus: String(data.appointment?.appointment_status ?? encounter.encounter_status ?? "completed"),
          goalAddressed: goalAddressed || activeGoalText,
          selections: structuredSelections,
          diagnoses: data.diagnoses.map((diagnosis) => ({
            code: String(diagnosis.diagnosis_code ?? ""),
            description: diagnosis.diagnosis_description ? String(diagnosis.diagnosis_description) : null,
          })).filter((diagnosis) => diagnosis.code),
        }} />}
      </div>
    </>
  );
}

function ContextButton({ active, label, short, onClick }: { active: boolean; label: string; short: string; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} title={label} className={active ? "encounter-context-tab active" : "encounter-context-tab"} onClick={onClick}><span>{short}</span><small>{label}</small></button>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="thera-field-label">{label}</div><div className="thera-field-value">{value}</div></div>;
}
