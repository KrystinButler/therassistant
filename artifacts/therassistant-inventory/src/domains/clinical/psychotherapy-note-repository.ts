import { tenantInsert, tenantSelect, tenantUpdate, type Row } from "../../lib/tenant-data-client";

type DataRow = Row & { id: string };

export async function getPsychotherapyNote(encounterId: string) {
  const rows = await tenantSelect<DataRow>("psychotherapy_notes", {
    encounter_id: `eq.${encounterId}`,
    limit: "1",
  });
  return rows[0] ?? null;
}

export async function savePsychotherapyNote(input: {
  encounterId: string;
  clientId: string;
  providerId?: string | null;
  noteText: string;
}) {
  const existing = await getPsychotherapyNote(input.encounterId);
  const values = {
    client_id: input.clientId,
    encounter_id: input.encounterId,
    provider_id: input.providerId || null,
    note_text: input.noteText,
  };
  return existing
    ? tenantUpdate<DataRow>("psychotherapy_notes", existing.id, values)
    : tenantInsert<DataRow>("psychotherapy_notes", values);
}
