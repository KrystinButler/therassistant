import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "DenialsPage.tsx"), "utf8");
const drawers = readFileSync(join(here, "ar-work-drawers.tsx"), "utf8");

if (page.includes("window.prompt(")) throw new Error("Denials workqueue must not use browser prompts.");
for (const fragment of ["WorkDenialDrawer", "CreateAppealDrawer", "AppealOutcomeDrawer"]) {
  if (!drawers.includes(fragment)) throw new Error(`Missing A/R drawer: ${fragment}`);
}
for (const fragment of ["Appeal deadline", "Appeal level", "Notes", "CARC", "RARC", "Workability", "Allowed amount", "Paid amount", "Patient responsibility", "Next follow-up", "Reference number", "Correct Claim"]) {
  if (!drawers.includes(fragment)) throw new Error(`Missing structured denial workflow field: ${fragment}`);
}
for (const fragment of ["queuePosition", "onPrevious", "onNext"]) {
  if (!page.includes(fragment)) throw new Error(`DenialsPage missing queue navigation fragment: ${fragment}`);
}

console.log("denials work drawer contract passed");
