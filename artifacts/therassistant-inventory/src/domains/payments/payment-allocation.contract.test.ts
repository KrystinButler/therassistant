import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "payment-work-drawers.tsx"), "utf8");

for (const fragment of [
  'allocations:',
  'Add allocation',
  'Remaining unapplied',
  'Apply Payment',
]) {
  if (!source.includes(fragment)) throw new Error(`Payment allocation drawer missing fragment: ${fragment}`);
}

console.log("payment allocation contract passed");
