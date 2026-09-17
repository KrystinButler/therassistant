import { tenantInsert, tenantUpdate, type Row } from "../../lib/tenant-data-client";

export type DemographicsDraft = {
  firstName: string;
  middleName?: string;
  lastName: string;
  preferredName?: string;
  dateOfBirth?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  clientStatus?: string;
  registrationStatus?: string;
};

export type ContactDraft = {
  contactName: string;
  relationship?: string;
  phone?: string;
  email?: string;
  isEmergencyContact?: boolean;
  isResponsibleParty?: boolean;
};

const CLIENT_STATUSES = new Set(["active", "inactive", "intake", "waitlist", "discharged", "deceased", "archived"]);
const REGISTRATION_STATUSES = new Set(["not_started", "in_progress", "pending_review", "complete", "needs_correction", "archived"]);

export function normalizePhone(value?: string) {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return value.trim();
  return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
}

export function validateDemographics(input: DemographicsDraft): Row {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName) throw new Error("First name is required.");
  if (!lastName) throw new Error("Last name is required.");

  const clientStatus = input.clientStatus || "active";
  const registrationStatus = input.registrationStatus || "in_progress";
  if (!CLIENT_STATUSES.has(clientStatus)) throw new Error("Invalid client status.");
  if (!REGISTRATION_STATUSES.has(registrationStatus)) throw new Error("Invalid registration status.");

  return {
    first_name: firstName,
    middle_name: input.middleName?.trim() || null,
    last_name: lastName,
    preferred_name: input.preferredName?.trim() || null,
    date_of_birth: input.dateOfBirth || null,
    email: input.email?.trim() || null,
    phone: normalizePhone(input.phone) || null,
    address_line1: input.addressLine1?.trim() || null,
    address_line2: input.addressLine2?.trim() || null,
    city: input.city?.trim() || null,
    state: input.state?.trim().toUpperCase() || null,
    postal_code: input.postalCode?.trim() || null,
    client_status: clientStatus,
    registration_status: registrationStatus,
  };
}

export function validateContact(input: ContactDraft): Row {
  const contactName = input.contactName.trim();
  if (!contactName) throw new Error("Contact name is required.");
  return {
    contact_name: contactName,
    relationship: input.relationship?.trim() || null,
    phone: normalizePhone(input.phone) || null,
    email: input.email?.trim() || null,
    is_emergency_contact: input.isEmergencyContact === true,
    is_responsible_party: input.isResponsibleParty === true,
  };
}

export function updatePatientDemographics(patientId: string, input: DemographicsDraft) {
  return tenantUpdate<Row & { id: string }>("clients", patientId, validateDemographics(input));
}

export function addPatientContact(patientId: string, input: ContactDraft) {
  return tenantInsert<Row & { id: string }>("client_contacts", {
    client_id: patientId,
    ...validateContact(input),
  });
}

export function updatePatientContact(contactId: string, input: ContactDraft) {
  return tenantUpdate<Row & { id: string }>("client_contacts", contactId, validateContact(input));
}
