import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "ar-work-drawers.tsx"), "utf8");

for (const fragment of [
  'Correct Claim',
  'Next follow-up',
  'Reference number',
  'Allowed amount',
  'Paid amount',
  'Patient responsibility',
]) {
  if (!source.includes(fragment)) throw new Error(`Denial drawer missing resolution fragment: ${fragment}`);
}

console.log("denial resolution contract passed");
