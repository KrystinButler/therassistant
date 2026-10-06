import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Exercise the real repository and billing evaluator; substitute only remote persistence.
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/domains/billing/repository.ts') && specifier === '../../lib/tenant-data-client') {
      return { url: 'data:text/javascript,' + encodeURIComponent(`
        export const tenantSelect = (...args) => globalThis.billingHandoff.select(...args);
        export const referenceSelect = tenantSelect;
        export const tenantInsert = (...args) => globalThis.billingHandoff.insert(...args);
        export const tenantUpdate = (...args) => globalThis.billingHandoff.update(...args);
        export const tenantRpc = (...args) => globalThis.billingHandoff.rpc(...args);
      `), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { createChargeFromEncounter, getBillingQueueData } = await import('../src/domains/billing/repository.ts');
hook.deregister();

function fixture() {
  const rows: Record<string, Array<Record<string, any>>> = {
    encounters: [{ id: 'enc-1', client_id: 'patient-1', provider_id: 'provider-1', payer_id: 'payer-1', billing_status: 'not_ready', started_at: '2026-10-04T15:00:00Z' }],
    clients: [{ id: 'patient-1', first_name: 'Synthetic', last_name: 'Patient', metadata: {} }],
    providers: [{ id: 'provider-1', first_name: 'Synthetic', last_name: 'Provider' }],
    payers: [{ id: 'payer-1', name: 'Synthetic payer' }],
    clinical_notes: [{ id: 'note-1', encounter_id: 'enc-1', note_status: 'signed', service_date: '2026-10-04', note_text: 'Signed record' }],
    encounter_diagnoses: [{ id: 'dx-1', encounter_id: 'enc-1', diagnosis_code: 'F41.1', is_primary: true }],
    encounter_service_lines: [
      { id: 'line-1', encounter_id: 'enc-1', cpt_hcpcs_code: '90791', units: 1, charge_amount_cents: 15000, place_of_service_code: '11' },
      { id: 'line-2', encounter_id: 'enc-1', cpt_hcpcs_code: '96127', units: 1, charge_amount_cents: 2000, place_of_service_code: '11' },
    ],
    eligibility_checks: [{ id: 'elig-1', eligibility_status: 'active' }],
    provider_payer_enrollments: [{ id: 'enroll-1', enrollment_status: 'approved' }],
    charge_capture_items: [], encounter_readiness_checks: [],
    workqueue_items: [{ id: 'pending-1', source_object_type: 'encounter', source_object_id: 'enc-1', workqueue_type: 'general_task', workqueue_status: 'open', title: 'Clinical billing handoff' }],
  };
  let failSecondCharge = false;
  let failConfirmation = false;
  (globalThis as any).billingHandoff = {
    async select(table: string, filters: Record<string, string> = {}) {
      return (rows[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => {
        if (value.startsWith('eq.') && row[key] !== undefined) return String(row[key]) === value.slice(3);
        if (value.startsWith('in.(') && row[key] !== undefined) return value.slice(4,-1).split(',').includes(String(row[key]));
        return true;
      }));
    },
    async insert(table: string, values: Record<string, unknown>) {
      if (table === 'charge_capture_items' && values.service_line_id === 'line-2' && failSecondCharge) throw new Error('Second charge request disconnected');
      const row = { id: table + '-' + (rows[table]?.length ?? 0), ...values };
      (rows[table] ??= []).push(row);
      return row;
    },
    async update(table: string, id: string, values: Record<string, unknown>) {
      const row = rows[table].find(row => row.id === id);
      assert.ok(row, `Missing ${table} ${id}`);
      Object.assign(row, values);
      return row;
    },
    async rpc(name: string) {
      assert.equal(name, 'complete_clinical_billing_handoff');
      if (failConfirmation) throw new Error('Confirmation response unavailable');
      rows.workqueue_items[0].workqueue_status = 'completed';
      return true;
    },
  };
  return { rows, failCapture(value: boolean) { failSecondCharge = value; }, failConfirmation() { failConfirmation = true; } };
}

test('partial charge capture leaves pending work and retry fills only the missing service line', async () => {
  const state = fixture();
  state.failCapture(true);
  const failed = await createChargeFromEncounter('enc-1');
  assert.equal(failed.ok, false);
  assert.equal(state.rows.charge_capture_items.length, 1);
  assert.equal(state.rows.workqueue_items[0].workqueue_status, 'open');
  state.failCapture(false);
  const recovered = await createChargeFromEncounter('enc-1');
  assert.equal(recovered.ok, true);
  assert.deepEqual(state.rows.charge_capture_items.map(row => row.service_line_id), ['line-1','line-2']);
  assert.equal(state.rows.workqueue_items[0].workqueue_status, 'completed');
  assert.equal(state.rows.clinical_notes[0].note_status, 'signed');
});

test('lost handoff confirmation reports pending work rather than losing saved charges', async () => {
  const state = fixture();
  state.failConfirmation();
  const result = await createChargeFromEncounter('enc-1');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'billing_handoff_pending');
  assert.equal(state.rows.charge_capture_items.length, 2);
  assert.equal(state.rows.workqueue_items[0].workqueue_status, 'open');
});

test('pending handoffs remain visible in the billing queue even after a partial capture', async () => {
  fixture();
  const data = await getBillingQueueData();
  assert.equal(data.encounters[0].billingHandoffPending, true);
});
