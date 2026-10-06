/** Match the organization-local date used by the database signing guard. */
export function clinicalServiceDate(startedAt: string, timeZone: string): string {
  const date = new Date(startedAt);
  if (!Number.isFinite(date.getTime())) throw new Error("Encounter start time is invalid.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
