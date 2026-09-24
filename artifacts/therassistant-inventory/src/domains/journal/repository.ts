import { tenantInsert, tenantUpdate, type Row } from "../../lib/tenant-data-client";
import { getSession } from "../../lib/supabase-client";
import { buildJournalEntryValues, type JournalEntryInput } from "../portal/workflow";

type DataRow = Row & { id: string };

export async function addJournalEntry(patientId: string, input: JournalEntryInput) {
  const session = await getSession();
  if (!session?.user?.id) throw new Error("An authenticated staff identity is required.");
  return tenantInsert<DataRow>("patient_journal_entries", {
    client_id: patientId,
    ...buildJournalEntryValues(input),
    recorded_by_staff_user_id: session.user.id,
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
