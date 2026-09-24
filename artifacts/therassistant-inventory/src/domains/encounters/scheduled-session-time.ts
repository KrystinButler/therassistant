type AppointmentTime = { starts_at?: unknown; ends_at?: unknown } | null | undefined;
export type ScheduledSessionTime = { start: string; end: string; minutes: number };
/** Calculate scheduled duration from timestamps (DST-safe); return local clock times for optional adjustment. */
export function scheduledSessionTime(appointment: AppointmentTime): ScheduledSessionTime | null {
  const start = new Date(String(appointment?.starts_at ?? ""));
  const end = new Date(String(appointment?.ends_at ?? ""));
  const elapsed = (end.getTime() - start.getTime()) / 60000;
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 1440) return null;
  const clock = (date: Date) => String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  return { start: clock(start), end: clock(end), minutes: Math.round(elapsed) };
}
