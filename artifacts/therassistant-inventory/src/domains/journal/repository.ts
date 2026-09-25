import { tenantUpdate, type Row } from "../../lib/tenant-data-client";

type DataRow = Row & { id: string };

// Only the authenticated patient portal may author patient journal entries.
// Staff permissions are limited to reviewing or flagging entries shared with the practice.
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
