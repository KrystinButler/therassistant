import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const sources: Record<string, string> = {
  "../../lib/tenant-data-client": "export const getCurrentTenantId = async () => 'tenant-1'; export const tenantSelect = (...args) => globalThis.claimPolicyHandoff.select(...args); export const referenceSelect = (...args) => globalThis.claimPolicyHandoff.select(...args);",
  "../claims/repository": "export const getClaimSubmissionData = () => globalThis.claimPolicyHandoff.claims();",
  "./payer-edi-defaults": "export const resolvePayerEdiConfig = (config) => config;",
};
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/billing/claim-output-repository.ts") && sources[specifier]) {
      return { url: "data:text/javascript," + encodeURIComponent(sources[specifier]), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { getClaimPreviewData, getBatchExportData } = await import("../src/domains/billing/claim-output-repository.ts");
hook.deregister();

function fixture() {
  const claim = { id: "claim-1", client_id: "client-1", payer_id: "payer-1", rendering_provider_id: "provider-1",
    source_encounter_id: "enc-1", metadata: { insurance_policy_id: "policy-original" } as Record<string, unknown> };
  const encounter = { id: "enc-1", insurance_policy_id: "policy-original" };
  const policies = [
    { id: "policy-new", client_id: "client-1", payer_id: "payer-1", status: "active", insurance_order: "primary", member_id: "NEW-MEMBER" },
    { id: "policy-original", client_id: "client-1", payer_id: "payer-1", status: "inactive", insurance_order: "primary", member_id: "ORIGINAL-MEMBER" },
  ];
  (globalThis as any).claimPolicyHandoff = {
    async select(table: string) {
      if (table === "professional_claims") return [claim];
      if (table === "encounters") return [encounter];
      if (table === "client_insurance_policies") return policies;
      if (table === "tenants") return [{ id: "tenant-1", settings: {} }];
      if (["professional_claim_lines", "claim_diagnoses", "clients", "providers", "payers"].includes(table)) return [];
      throw new Error("Unexpected table: " + table);
    },
    async claims() { return { claims: [claim], batches: [{ id: "batch-1", claimIds: ["claim-1"] }] }; },
  };
  return { claim, encounter, policies };
}

test("claim preview retains the captured policy despite newer active coverage with the same payer", async () => {
  fixture();
  const result = await getClaimPreviewData("claim-1");
  assert.equal(result.item.policy?.member_id, "ORIGINAL-MEMBER");
});

test("batch export uses the same captured policy as claim preview", async () => {
  fixture();
  const result = await getBatchExportData("batch-1");
  assert.equal(result.claims[0].policy?.member_id, "ORIGINAL-MEMBER");
});

test("missing captured policy stops export instead of substituting a different member ID", async () => {
  const state = fixture();
  state.policies.pop();
  await assert.rejects(getBatchExportData("batch-1"), /policy/i);
});

test("captured policy belonging to another patient is rejected", async () => {
  const state = fixture();
  state.policies[1].client_id = "other-client";
  await assert.rejects(getClaimPreviewData("claim-1"), /policy/i);
});

test("claims created before policy snapshotting use their exact source encounter policy", async () => {
  const state = fixture();
  state.claim.metadata = {};
  const result = await getClaimPreviewData("claim-1");
  assert.equal(result.item.policy?.member_id, "ORIGINAL-MEMBER");
});

test("legacy claims without a source encounter or snapshot retain the existing policy fallback", async () => {
  const state = fixture();
  state.claim.metadata = {};
  state.claim.source_encounter_id = "";
  const result = await getClaimPreviewData("claim-1");
  assert.equal(result.item.policy?.member_id, "NEW-MEMBER");
});
