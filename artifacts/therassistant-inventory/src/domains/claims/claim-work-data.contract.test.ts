import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = readFileSync(join(here, "workspace-repository.ts"), "utf8");
const drawer = readFileSync(join(here, "claim-work-drawer.tsx"), "utf8");

for (const fragment of [
  "getClaimWorkData",
  'tenantSelect<DataRow>("professional_claim_lines"',
  'tenantSelect<DataRow>("claim_diagnoses"',
  'tenantSelect<DataRow>("submission_responses"',
  'tenantSelect<DataRow>("denials"',
  'tenantSelect<DataRow>("appeals"',
  'tenantSelect<DataRow>("workqueue_items"',
  'tenantSelect<DataRow>("claim_status_history"',
]) {
  if (!repository.includes(fragment)) throw new Error(`Missing repository contract: ${fragment}`);
}

for (const fragment of ["Claim Lines", "Diagnoses", "Clearinghouse Responses", "Denials", "Appeals", "Work Items", "Notes / History"]) {
  if (!drawer.includes(fragment)) throw new Error(`Missing drawer section: ${fragment}`);
}

console.log("claim work drawer data contract passed");
