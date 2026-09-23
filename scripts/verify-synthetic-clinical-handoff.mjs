const SUPABASE_URL = (process.env.E2E_SUPABASE_URL ?? process.env.SUPABASE_URL)?.replace(/\/$/, "");
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SECRET_KEY) {
  throw new Error("Local Supabase URL and secret/service-role key are required.");
}

const IDS = {
  appointment: "50000000-0000-4000-8000-000000000001",
  provider: "20000000-0000-4000-8000-000000000001",
};

const headers = {
  apikey: SECRET_KEY,
  Authorization: `Bearer ${SECRET_KEY}`,
};

async function rows(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${table} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : [];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [appointment] = await rows(
  "appointments",
  `id=eq.${IDS.appointment}&select=id,appointment_status,completed_at`,
);
assert(appointment, "Synthetic appointment was not found.");
assert(appointment.appointment_status === "completed", "Synthetic appointment did not complete.");
assert(Boolean(appointment.completed_at), "Synthetic appointment completion timestamp is missing.");

const encounters = await rows(
  "encounters",
  `appointment_id=eq.${IDS.appointment}&select=id,encounter_status,billing_status,provider_id,client_id,appointment_id&order=created_at.desc&limit=1`,
);
const encounter = encounters[0];
assert(encounter, "Synthetic encounter was not created.");
assert(encounter.encounter_status === "completed", "Synthetic encounter did not complete.");
assert(encounter.provider_id === IDS.provider, "Synthetic encounter is not linked to the provider identity.");

const notes = await rows(
  "clinical_notes",
  `encounter_id=eq.${encounter.id}&select=id,note_status,locked_at,note_text&order=created_at.desc&limit=1`,
);
const note = notes[0];
assert(note, "Synthetic clinical note was not created.");
assert(["signed", "locked"].includes(note.note_status), "Synthetic clinical note was not signed.");
assert(Boolean(note.locked_at), "Synthetic clinical note was not locked.");
assert(String(note.note_text ?? "").includes("Synthetic psychotherapy progress note"), "Synthetic clinical note text was not saved.");

const signatures = await rows(
  "clinical_note_signatures",
  `clinical_note_id=eq.${note.id}&select=id,provider_id,signed_at,signature_text&order=signed_at.desc&limit=1`,
);
const signature = signatures[0];
assert(signature, "Synthetic clinical signature was not created.");
assert(signature.provider_id === IDS.provider, "Clinical signature is linked to the wrong provider.");
assert(Boolean(signature.signed_at), "Clinical signature timestamp is missing.");

const serviceLines = await rows(
  "encounter_service_lines",
  `encounter_id=eq.${encounter.id}&select=id,cpt_hcpcs_code,units,charge_amount_cents,place_of_service_code&order=created_at.asc`,
);
const line = serviceLines.find((row) => row.cpt_hcpcs_code === "90837" && Number(row.charge_amount_cents) === 15000);
assert(line, "Expected synthetic 90837 service line for $150.00 was not created.");
assert(Number(line.units) === 1, "Synthetic service line units are incorrect.");
assert(String(line.place_of_service_code) === "02", "Generic synthetic telehealth visit should default to place of service 02.");

const charges = await rows(
  "charge_capture_items",
  `encounter_id=eq.${encounter.id}&select=id,service_line_id,clinical_note_id,payer_id,cpt_code,charge_amount_cents,charge_status&order=created_at.asc`,
);
const charge = charges.find((row) => row.service_line_id === line.id);
assert(charge, "Synthetic service line did not produce a charge.");
assert(charge.clinical_note_id === note.id, "Synthetic charge is not linked to the signed note.");
assert(charge.payer_id === null, "Self-pay synthetic charge should not have a payer.");
assert(charge.cpt_code === "90837", "Synthetic charge CPT is incorrect.");
assert(Number(charge.charge_amount_cents) === 15000, "Synthetic charge amount is incorrect.");
assert(charge.charge_status === "patient_responsibility", "Self-pay synthetic charge did not become patient responsibility.");

console.log("Synthetic visit verified: schedule → encounter → signed note → service line → patient-responsibility charge.");
