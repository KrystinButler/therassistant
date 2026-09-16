import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const drawer = readFileSync(join(here, "claim-work-drawer.tsx"), "utf8");

for (const fragment of [
  "getClaimErrorGuidance",
  "What is wrong",
  "Why it matters",
  "What to correct",
  "data-claim-field",
  "scrollIntoView",
  "focus()",
]) {
  if (!drawer.includes(fragment)) throw new Error(`Missing claim guidance UI contract: ${fragment}`);
}

console.log("claim error guidance UI contract passed");
