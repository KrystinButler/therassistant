import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "BillingQueuePage.tsx"), "utf8");
const drawer = readFileSync(join(here, "charge-work-drawer.tsx"), "utf8");

for (const fragment of ["ChargeWorkDrawer", "activeEncounterId", "onOpenCharge", "onOpenEncounter"]) {
  if (!page.includes(fragment)) throw new Error(`Missing billing workspace drawer contract: ${fragment}`);
}
for (const fragment of ["WorkDrawer", "Billing Readiness", "Blocking Issues", "Run Audit", "Create Charge", "Create Claim", "Open Encounter"]) {
  if (!drawer.includes(fragment)) throw new Error(`Missing charge drawer behavior: ${fragment}`);
}
if (drawer.includes("window.prompt")) throw new Error("Charge drawer must not use browser prompts");
console.log("billing work drawer contract passed");
