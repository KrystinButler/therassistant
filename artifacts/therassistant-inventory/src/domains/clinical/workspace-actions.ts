/** A date-only field must never be initialized through UTC midnight. */
export function formDate(serviceDate?: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, now = new Date()): string {
  if (serviceDate && /^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return serviceDate;
  const parts = new Intl.DateTimeFormat('en-US', {timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function unsignedRows<T extends {signed: boolean}>(rows: T[]): T[] { return rows.filter(row => !row.signed); }
export async function saveThenSign<T, R>(save: () => Promise<T>, sign: (saved:T) => Promise<R>): Promise<R> {
  const saved = await save();
  return sign(saved);
}

/** Input is ordered by updated_at descending by the clinical queue query. */
export function encountersByAppointment<T extends { appointment_id?: string | null; encounter_status?: string | null }>(rows: readonly T[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const encounter of rows) {
    if (encounter.appointment_id && encounter.encounter_status !== "voided" && !index.has(encounter.appointment_id)) {
      index.set(encounter.appointment_id, encounter);
    }
  }
  return index;
}
