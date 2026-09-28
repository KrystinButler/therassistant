/** Directory-specific normalization policy, not a general FHIR R4 validator.
 * Role identifiers are not normally practitioner NPIs. Use this boundary only
 * for directory feeds whose agreed contract supplies an NPI on the role.
 * Returns an internal DTO, not a serializable conformant FHIR resource.
 */
export const NPI_SYSTEM = 'http://hl7.org/fhir/sid/us-npi';
export const NUCC_SYSTEM = 'http://nucc.org/provider-taxonomy';
type RecordValue = Record<string, unknown>;
export class PractitionerRoleValidationError extends Error {
  readonly code: string;
  readonly field: string;
  constructor(code: string, field: string, message: string) {
    super(message);
    this.name = 'PractitionerRoleValidationError';
    this.code = code;
    this.field = field;
  }
}
export type TaxonomyDependencies = {
  /** Version of the trusted NUCC dataset used by taxonomyExists. */
  taxonomyVersion: string;
  /** Must check actual membership and effective status, not merely a regex. */
  taxonomyExists: (code: string) => boolean | Promise<boolean>;
};
function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
}
function array(value: unknown, field: string): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new PractitionerRoleValidationError('INVALID_STRUCTURE', field, `${field} must be an array`);
  return value;
}
function validNpi(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[12]\d{9}$/.test(value)) return false;
  // NPI Luhn calculation includes the ISO health-industry prefix 80840.
  const digits = `80840${value}`;
  let sum = 0;
  for (let i = digits.length - 1, position = 0; i >= 0; i--, position++) {
    let digit = Number(digits[i]);
    if (position % 2) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}
export async function normalizePractitionerRole(payload: unknown, dependencies: TaxonomyDependencies) {
  const source = record(payload);
  if (source?.resourceType !== 'PractitionerRole') throw new PractitionerRoleValidationError('INVALID_RESOURCE', 'resourceType', 'Expected PractitionerRole');
  if (!dependencies?.taxonomyVersion?.trim() || typeof dependencies.taxonomyExists !== 'function') throw new Error('A versioned NUCC taxonomy lookup is required');
  const identifiers = Array.isArray(source.identifier) ? source.identifier : [];
  const npis = identifiers.map(record).filter(item => item?.system === NPI_SYSTEM).map(item => item!.value);
  if (!npis.length || npis.some(value => !validNpi(value)) || new Set(npis).size !== 1) throw new PractitionerRoleValidationError('INVALID_NPI', 'identifier', 'One unambiguous, checksum-valid NPI is required');
  const specialties: { system: string; code: string; display?: string }[] = [];
  for (const concept of array(source.specialty, 'specialty')) {
    const coding = array(record(concept)?.coding, 'specialty.coding').map(record).filter(item => item?.system === NUCC_SYSTEM);
    if (!coding.length) throw new PractitionerRoleValidationError('INVALID_TAXONOMY', 'specialty', 'Specialty requires NUCC taxonomy coding');
    for (const item of coding) {
      const code = item!.code;
      if (typeof code !== 'string' || !code || !(await dependencies.taxonomyExists(code))) throw new PractitionerRoleValidationError('INVALID_TAXONOMY', 'specialty.coding.code', 'Unknown or inactive NUCC taxonomy code');
      if (!specialties.some(s => s.code === code)) specialties.push({ system: NUCC_SYSTEM, code, ...(typeof item!.display === 'string' ? {display:item!.display} : {}) });
    }
  }
  const telecom = {workEmails: [] as string[], clinicPhones: [] as string[]};
  for (const member of array(source.telecom, 'telecom')) {
    const contact = record(member);
    if (contact?.use !== 'work' || typeof contact.value !== 'string' || !contact.value.trim()) continue;
    if (contact.system === 'email') telecom.workEmails.push(contact.value);
    if (contact.system === 'phone') telecom.clinicPhones.push(contact.value);
  }
  const healthcareService = array(source.healthcareService, 'healthcareService').map(record).flatMap(item => typeof item?.reference === 'string' && item.reference.trim() ? [item.reference] : []);
  return {
    sourceResourceType: 'PractitionerRole' as const,
    ...(typeof source.id === 'string' ? {id:source.id} : {}),
    npi: npis[0] as string,
    taxonomyVersion: dependencies.taxonomyVersion,
    specialties, telecom, healthcareService,
    // Compatibility-only default: qualifications belong to Practitioner.
    qualification: [] as never[],
  };
}
