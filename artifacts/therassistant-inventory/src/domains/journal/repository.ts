import { demoInsert, demoUpdate, type Row } from "../../lib/supabase-demo-client";
import { buildJournalEntryValues } from "../portal/workflow";

type DataRow = Row & { id: string };

export function addJournalEntry(patientId: string, input: { entryText: string; mood?: string }) {
  return demoInsert<DataRow>("patient_journal_entries", {
    client_id: patientId,
    ...buildJournalEntryValues(input),
  });
}

export function markJournalReviewed(entryId: string, providerId?: string) {
  return demoUpdate<DataRow>("patient_journal_entries", entryId, {
    review_status: "reviewed",
    reviewed_at: new Date().toISOString(),
    reviewed_by_provider_id: providerId || null,
  });
}

export function flagJournalEntry(entryId: string) {
  return demoUpdate<DataRow>("patient_journal_entries", entryId, {
    review_status: "flagged",
  });
}
