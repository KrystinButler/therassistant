export type DirectDocumentationInput = {
  clientId: string;
  providerId: string;
  serviceType: string;
  serviceDate: string;
  locationType: string;
};
const acceptedLocations = new Set(["telehealth","office","phone","other"]);

/** Validate user-supplied chart fields before the tenant-scoped insert. */
export function buildDirectDocumentationDraft(input: DirectDocumentationInput) {
  const clientId = input.clientId.trim();
  const providerId = input.providerId.trim();
  const serviceType = input.serviceType.trim();
  const date = input.serviceDate;
  if (!clientId || !providerId) throw new Error("Patient and rendering provider are required.");
  if (!serviceType || serviceType.length > 100) throw new Error("Select a valid clinical note type.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Enter a valid service date.");
  const time = new Date(date + "T12:00:00");
  if (Number.isNaN(time.getTime()) || time.getFullYear() !== Number(date.slice(0,4)) ||
    time.getMonth() + 1 !== Number(date.slice(5,7)) || time.getDate() !== Number(date.slice(8,10)))
    throw new Error("Enter an actual calendar date.");
  const endOfToday = new Date(); endOfToday.setHours(23,59,59,999);
  if (time > endOfToday) throw new Error("Clinical documentation cannot use a future service date.");
  if (!acceptedLocations.has(input.locationType)) throw new Error("Select a valid visit location.");
  return {
    appointment_id: null,
    client_id: clientId,
    provider_id: providerId,
    service_type: serviceType,
    location_type: input.locationType,
    started_at: time.toISOString(),
    encounter_status: "in_progress",
    billing_status: "not_ready",
    funding_context: {},
  };
}
