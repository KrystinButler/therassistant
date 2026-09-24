import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import {
  addEncounterDiagnosis,
  addEncounterServiceLine,
  saveClinicalNote,
  signEncounterNote,
} from "../clinical/repository";
import { buildPatientReviewCheckIn } from "../scheduling/patient-review-model";
import { treatmentPlanAlert } from "../treatment-plans/workflow";
import { ExternalSummaryPanel } from "../clinical/ExternalSummaryPanel";
import { FastChartingPanel } from "../clinical/FastChartingPanel";
import { createSmartPhrase, getFastChartingContext, getSmartPhrases } from "../clinical/fast-charting-repository";
import { clinicalNoteSimilarity, emptyStructuredSelections, expandSmartPhraseAtCursor, synthesizeStructuredNarrative, type PriorStructuredContext, type SmartPhrase, type StructuredSelections } from "../clinical/fast-charting";
import { forensicContextForCarryForward } from "../clinical/forensic-context";
import { psychedelicContextForCarryForward } from "../clinical/psychedelic-context";
import { Icd10SearchInput } from "../coding/Icd10SearchInput";
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
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteType, setNoteType] = useState("psychotherapy");
  const [goalAddressed, setGoalAddressed] = useState("");
  const [diagnosisCode, setDiagnosisCode] = useState("");
  const [diagnosisDescription, setDiagnosisDescription] = useState("");
  const [serviceCode, setServiceCode] = useState("");
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
      setNoteType(String(note?.note_type ?? "psychotherapy"));
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save encounter changes.");
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

  async function addServiceLine() {
    const amount = Math.round(Number(chargeDollars || 0) * 100);
    await withSave(
      () => addEncounterServiceLine(encounterId, {
        cptCode: serviceCode,
        modifier1,
        units,
        chargeAmountCents: amount,
        placeOfService,
      }),
      "Service line added to encounter.",
      true,
    );
    setModifier1("");
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
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const providerId = String(data?.encounter.provider_id ?? "");
      await saveClinicalNote(encounterId, { noteType, noteText, goalAddressed, structuredSelections, generatedNarrative, carryForwardContext });
      const result = await signEncounterNote(encounterId, providerId, signatureText);
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage("Clinical note signed and locked. THERASSISTANT handed the encounter to Charge Capture; any billing exceptions remain outside the clinical workflow.");
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
            <label><div className="thera-field-label">Note Type</div><select className="thera-input" value={noteType} disabled={signed} onChange={(event) => setNoteType(event.target.value)}><option value="psychotherapy">Psychotherapy</option><option value="assessment">Assessment</option><option value="intake">Intake</option><option value="crisis">Crisis</option><option value="case_management">Case Management</option><option value="medication_management">Medication Management</option><option value="other">Other</option></select></label>
            <label><div className="thera-field-label">Goal / Objective Addressed</div><input className="thera-input" value={goalAddressed} disabled={signed} onChange={(event) => setGoalAddressed(event.target.value)} placeholder="Goal or objective addressed" /></label>
          </div>
          <div className="encounter-editor-wrap"><label><div className="thera-field-label">Session / SOAP Note</div><textarea ref={noteRef} className="thera-input encounter-note-editor" value={noteText} disabled={signed} onChange={(event) => handleNoteChange(event.target.value, event.target.selectionStart)} placeholder="Document subjective/objective findings, assessment, interventions, response, plan, risk, and relevant clinical context. Type / for quick inserts." /></label>{showSlashMenu && !signed && <div className="encounter-slash-menu"><div>QUICK INSERTS</div><button type="button" onClick={() => injectQuickText("Risk Assessment: Client denies suicidal or homicidal ideation. No acute safety concerns reported.")}>Risk: Standard Negative</button><button type="button" onClick={() => injectQuickText("Mental Status: Alert and oriented x4. Appearance and behavior appropriate. Speech normal. Thought process linear and goal directed.")}>MSE: Within Normal Limits</button><button type="button" onClick={() => injectQuickText("Intervention: Supportive psychotherapy, reflective listening, validation, and collaborative problem solving were utilized.")}>Intervention: Supportive</button></div>}</div>
          <FastChartingPanel signed={signed} phrases={smartPhrases} selections={structuredSelections} generatedNarrative={generatedNarrative} priorContext={priorStructuredContext} noteSimilarity={noteSimilarity} onSelectionsChange={setStructuredSelections} onInsertNarrative={() => injectIntoNote("\n" + generatedNarrative + "\n")} onInsertPhrase={injectIntoNote} onCarryForward={carryForwardStructured} onCreatePhrase={addSmartPhrase} />
          {!signed && <div className="encounter-note-actions"><button type="button" className="thera-action" disabled={saving || !noteText.trim()} onClick={() => void saveNote()}>{saving ? "Saving..." : "Save Note"}</button><span>Saving does not sign or lock the clinical record.</span></div>}
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
        <section className="thera-card thera-span-2">
          <div className="thera-card-header">
            <div>
              <div className="thera-eyebrow">FUNDING → BILLING PATH</div>
              <h2>Funding Source</h2>
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
        <section className="thera-card"><div className="thera-card-header"><div><div className="thera-eyebrow">CLINICAL CONTEXT</div><h2>Diagnoses</h2></div></div>{data.diagnoses.length > 0 && <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Code</th><th>Description</th><th>Primary</th></tr></thead><tbody>{data.diagnoses.map((diagnosis) => <tr key={diagnosis.id}><td><strong>{String(diagnosis.diagnosis_code)}</strong></td><td>{String(diagnosis.diagnosis_description ?? "—")}</td><td>{diagnosis.is_primary ? "Yes" : "No"}</td></tr>)}</tbody></table></div>}{!signed && <div className="encounter-compact-form"><Icd10SearchInput code={diagnosisCode} description={diagnosisDescription} serviceDate={serviceDate} onSelect={(result) => { setDiagnosisCode(result.code); if (result.name) setDiagnosisDescription(result.name); }} /><input className="thera-input" placeholder="Diagnosis description" value={diagnosisDescription} onChange={(event) => setDiagnosisDescription(event.target.value)} /><button type="button" className="thera-action secondary" disabled={saving || !diagnosisCode.trim()} onClick={() => void addDiagnosis()}>+ Add Diagnosis</button></div>}</section>
        <section className="thera-card"><div className="thera-card-header"><div><div className="thera-eyebrow">CODE</div><h2>Coding & Service</h2></div></div><div className="encounter-coding-summary"><Field label="Scheduled Time" value={duration ? `${duration} minutes` : "Not available"} /><Field label="Visit Location" value={String(encounter.location_type ?? "—").replaceAll("_", " ")} /><Field label="Current POS" value={placeOfService || "—"} /><Field label="Payer" value={String(data.payer?.name ?? "—")} /></div>{!signed && <div className="encounter-service-form"><ProcedureCodeSearchInput code={serviceCode} serviceDate={serviceDate} onSelect={(result) => setServiceCode(result.code)} /><input className="thera-input" placeholder="Modifier" value={modifier1} onChange={(event) => setModifier1(event.target.value.toUpperCase())} /><input className="thera-input" type="number" min={1} value={units} onChange={(event) => setUnits(Number(event.target.value))} /><PlaceOfServiceSearchInput code={placeOfService} onSelect={(result) => setPlaceOfService(result.code)} /><input className="thera-input" type="number" step="0.01" min="0" placeholder="Charge $" value={chargeDollars} onChange={(event) => setChargeDollars(event.target.value)} /><button type="button" className="thera-action secondary" disabled={saving || !serviceCode.trim()} onClick={() => void addServiceLine()}>+ Add Service Line</button></div>}</section>
        <section className="thera-card thera-span-2 encounter-sign-card"><div className="thera-card-header"><div><div className="thera-eyebrow">REVIEW → SIGN</div><h2>Documentation Readiness & Signature</h2><p>Billing follow-up never prevents completion of the clinical record.</p></div><StatusBadge value={billingFollowUpCount ? "billing_follow_up" : "ready"} /></div><div className="encounter-readiness-grid">{completionChecks.map((check) => <div className="encounter-readiness-item" key={check.label}><StatusBadge value={check.status} /><div><strong>{check.label}</strong><span>{check.detail}</span></div></div>)}</div><div className="encounter-nonblocking-note">{billingFollowUpCount ? `${billingFollowUpCount} item(s) still need billing/coding follow-up. You may still sign the clinical note; THERASSISTANT will route those issues outside the clinical workflow.` : "The clinical record and current billing details are ready for handoff."}</div>{signed ? <div className="encounter-signed-handoff"><div><strong>Signed clinical record → Charge Capture</strong><span>The note is locked. Billing/coding corrections can continue without changing provider documentation.</span></div><Link href="/billing/charges" className="thera-action">Open Charge Capture</Link></div> : <div className="encounter-sign-row"><label><div className="thera-field-label">Provider Signature</div><input className="thera-input" value={signatureText} onChange={(event) => setSignatureText(event.target.value)} placeholder="Provider signature" /></label><button type="button" className="thera-action" disabled={saving || !noteText.trim() || !signatureText.trim()} onClick={() => void sign()}>{saving ? "Signing..." : "Sign & Lock Note"}</button></div>}</section>
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
