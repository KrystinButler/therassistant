import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "ArWorkspacePage.tsx"), "utf8");
const drawers = readFileSync(join(here, "ar-work-drawers.tsx"), "utf8");

if (page.includes("window.prompt(")) throw new Error("A/R workspace must not use browser prompts.");
for (const fragment of ["WorkDenialDrawer", "CreateAppealDrawer", "AppealOutcomeDrawer", "UnderpaymentReviewDrawer", "RecoveryReviewDrawer"]) {
  if (!drawers.includes(fragment)) throw new Error(`Missing A/R drawer: ${fragment}`);
}
for (const fragment of ["Appeal deadline", "Appeal level", "Notes", "CARC", "RARC", "Workability"]) {
  if (!drawers.includes(fragment)) throw new Error(`Missing structured A/R field: ${fragment}`);
}
console.log("A/R work drawer contract passed");
