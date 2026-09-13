import test from "node:test";
import assert from "node:assert/strict";

import { buildClientChartRelationships } from "../src/domains/clients/chart.ts";

test("client chart links encounters to charges, claims and work items", () => {
  const result = buildClientChartRelationships({
    clientId: "client-1",
    encounters: [
      { id: "enc-1", client_id: "client-1", appointment_id: "appt-1", provider_id: "provider-1", payer_id: "payer-1", encounter_status: "closed", billing_status: "claimed" },
      { id: "enc-other", client_id: "client-2", appointment_id: "appt-2", provider_id: "provider-2", payer_id: "payer-2" },
    ],
    appointments: [{ id: "appt-1", client_id: "client-1" }],
    providers: [{ id: "provider-1", first_name: "Jamie", last_name: "Parker" }],
    payers: [{ id: "payer-1", name: "Anthem" }],
    charges: [{ id: "charge-1", client_id: "client-1", encounter_id: "enc-1", charge_status: "claim_created" }],
    claims: [{ id: "claim-1", client_id: "client-1", source_encounter_id: "enc-1", claim_status: "paid" }],
    workItems: [
      { id: "work-client", source_object_type: "client", source_object_id: "client-1" },
      { id: "work-appt", source_object_type: "appointment", source_object_id: "appt-1" },
      { id: "work-enc", source_object_type: "encounter", source_object_id: "enc-1" },
      { id: "work-claim", source_object_type: "claim", source_object_id: "claim-1" },
      { id: "work-other", source_object_type: "claim", source_object_id: "claim-other" },
    ],
  });

  assert.equal(result.encounters.length, 1);
  assert.equal(result.encounters[0].providerName, "Jamie Parker");
  assert.equal(result.encounters[0].payerName, "Anthem");
  assert.equal(result.encounters[0].chargeCount, 1);
  assert.equal(result.encounters[0].claimCount, 1);
  assert.equal(result.encounters[0].latestClaimStatus, "paid");
  assert.deepEqual(result.workItems.map((row) => row.id).sort(), ["work-appt", "work-claim", "work-client", "work-enc"]);
});
