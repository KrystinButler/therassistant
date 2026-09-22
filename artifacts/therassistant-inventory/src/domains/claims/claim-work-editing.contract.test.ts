import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = readFileSync(join(here, "workspace-repository.ts"), "utf8");
const drawer = readFileSync(join(here, "claim-work-drawer.tsx"), "utf8");

for (const fragment of [
  "saveClaimWorkFields",
  'tenantUpdate<DataRow>("professional_claims"',
  "validateClaim(claimId)",
  "saveClaimLineCorrections",
  'tenantUpdate<DataRow>("professional_claim_lines"',
]) {
  if (!repository.includes(fragment)) throw new Error(`Missing claim edit repository contract: ${fragment}`);
}

for (const fragment of [
  "dirty={dirty}",
  "Save & Revalidate",
  "Save & Continue",
  "Claim Lines",
  "Diagnoses",
]) {
  if (!drawer.includes(fragment)) throw new Error(`Missing claim edit drawer contract: ${fragment}`);
}

console.log("claim work drawer editing contract passed");
