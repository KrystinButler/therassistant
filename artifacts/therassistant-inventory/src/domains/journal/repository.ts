import { tenantInsert, tenantUpdate, type Row } from "../../lib/tenant-data-client";
import { buildJournalEntryValues, type JournalEntryInput } from "../portal/workflow";

type DataRow = Row & { id: string };

export function addJournalEntry(patientId: string, input: JournalEntryInput) {
  return tenantInsert<DataRow>("patient_journal_entries", {
    client_id: patientId,
    ...buildJournalEntryValues(input),
  });
}

export function markJournalReviewed(entryId: string, providerId?: string) {
  return tenantUpdate<DataRow>("patient_journal_entries", entryId, {
    review_status: "reviewed",
    reviewed_at: new Date().toISOString(),
    reviewed_by_provider_id: providerId || null,
  });
}

export function flagJournalEntry(entryId: string) {
  return tenantUpdate<DataRow>("patient_journal_entries", entryId, {
    review_status: "flagged",
  });
}
