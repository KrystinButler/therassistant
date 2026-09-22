import { tenantInsert, tenantSelect, tenantUpdate, type Row } from "../../lib/tenant-data-client";
import {
  DEFAULT_SMART_PHRASES,
  normalizeSmartPhraseShortcut,
  normalizeStructuredSelections,
  type PriorStructuredContext,
  type SmartPhrase,
  type SmartPhraseScope,
  type StructuredSelections,
} from "./fast-charting";

type DataRow = Row & { id: string };

function first<T>(rows: T[]) { return rows[0] ?? null; }
function inFilter(ids: string[]) { return "in.(" + ids.join(",") + ")"; }
function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }

function phraseFromRow(row: DataRow): SmartPhrase {
  return {
    id: row.id,
    shortcut: String(row.shortcut ?? ""),
    label: String(row.label ?? row.shortcut ?? "SmartPhrase"),
    content: String(row.content ?? ""),
    category: row.category ? String(row.category) : null,
    scope: row.owner_user_id ? "user" : "practice",
  };
}

export async function getSmartPhrases() {
  const rows = await tenantSelect<DataRow>("smart_phrases", { is_active: "eq.true", order: "shortcut.asc" });
  const customs = rows.map(phraseFromRow);
  const merged = new Map<string, SmartPhrase>();
  for (const phrase of DEFAULT_SMART_PHRASES) merged.set(phrase.shortcut.toLowerCase(), phrase);
  for (const phrase of customs) merged.set(phrase.shortcut.toLowerCase(), phrase);
  return [...merged.values()].sort((a, b) => a.shortcut.localeCompare(b.shortcut));
}

export async function createSmartPhrase(input: { shortcut: string; label: string; content: string; scope: Exclude<SmartPhraseScope, "built_in"> }) {
  const shortcut = normalizeSmartPhraseShortcut(input.shortcut);
  if (!/^\.[a-z0-9_-]{1,40}$/i.test(shortcut)) throw new Error("SmartPhrase shortcut must start with a dot and contain only letters, numbers, hyphens, or underscores.");
  if (!input.content.trim()) throw new Error("SmartPhrase content is required.");
  const values: Row = {
    shortcut,
    label: input.label.trim() || shortcut,
    content: input.content.trim(),
    is_active: true,
  };
  if (input.scope === "practice") values.owner_user_id = null;
  const row = await tenantInsert<DataRow>("smart_phrases", values);
  return phraseFromRow(row);
}

export async function getFastChartingContext(clientId: string, encounterId: string, clinicalNoteId?: string) {
  const currentPromise = clinicalNoteId
    ? tenantSelect<DataRow>("clinical_note_structured_data", { clinical_note_id: "eq." + clinicalNoteId, limit: "1" })
    : Promise.resolve([] as DataRow[]);
  const [phrases, currentRows, priorNotes] = await Promise.all([
    getSmartPhrases(),
    currentPromise,
    tenantSelect<DataRow>("clinical_notes", {
      client_id: "eq." + clientId,
      encounter_id: "neq." + encounterId,
      note_status: "in.(signed,locked)",
      order: "service_date.desc,created_at.desc",
      limit: "10",
    }),
  ]);

  const priorIds = priorNotes.map((row) => row.id);
  const structuredRows = priorIds.length
    ? await tenantSelect<DataRow>("clinical_note_structured_data", { clinical_note_id: inFilter(priorIds) })
    : [];
  const structuredByNote = new Map(structuredRows.map((row) => [String(row.clinical_note_id ?? ""), row]));
  const priorNote = priorNotes.find((row) => structuredByNote.has(row.id)) ?? first(priorNotes);
  let prior: PriorStructuredContext | null = null;
  if (priorNote) {
    const structured = structuredByNote.get(priorNote.id);
    prior = {
      noteId: priorNote.id,
      serviceDate: priorNote.service_date ? String(priorNote.service_date) : null,
      goalAddressed: String(priorNote.goal_addressed ?? ""),
      selections: normalizeStructuredSelections(structured?.selections),
    };
  }

  const current = first(currentRows);
  return {
    phrases,
    current: current ? {
      selections: normalizeStructuredSelections(current.selections),
      generatedNarrative: String(current.generated_narrative ?? ""),
      carryForwardContext: record(current.carry_forward_context),
    } : null,
    prior,
  };
}

export async function saveStructuredClinicalData(note: DataRow, values: {
  selections: StructuredSelections;
  generatedNarrative: string;
  carryForwardContext: Row;
}) {
  const noteId = String(note.id ?? "");
  const encounterId = String(note.encounter_id ?? "");
  const clientId = String(note.client_id ?? "");
  if (!noteId || !encounterId || !clientId) throw new Error("Clinical note context is incomplete.");
  const payload: Row = {
    clinical_note_id: noteId,
    encounter_id: encounterId,
    client_id: clientId,
    provider_id: note.provider_id || null,
    selections: values.selections,
    generated_narrative: values.generatedNarrative || null,
    carry_forward_context: values.carryForwardContext,
  };
  const existing = await tenantSelect<DataRow>("clinical_note_structured_data", { clinical_note_id: "eq." + noteId, limit: "1" });
  return existing[0]
    ? tenantUpdate<DataRow>("clinical_note_structured_data", existing[0].id, payload)
    : tenantInsert<DataRow>("clinical_note_structured_data", payload);
}
