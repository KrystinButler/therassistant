import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "claim-work-drawer.tsx"), "utf8");

for (const fragment of [
  'mode?: "claims" | "rejection"',
  'initialSection?: ClaimWorkSection',
  'Last payer response',
  'Next follow-up',
  'Save Draft',
  'Resubmit Claim',
]) {
  if (!source.includes(fragment)) throw new Error(`ClaimWorkDrawer missing mode contract fragment: ${fragment}`);
}

console.log("claim work drawer mode contract passed");
