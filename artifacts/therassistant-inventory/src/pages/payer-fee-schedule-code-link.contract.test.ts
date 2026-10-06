import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "payer-detail.tsx"), "utf8");

for (const fragment of [
  'ProcedureCodeSearchInput',
  'label="CPT / HCPCS Code"',
  'cpt_code: form.cpt_code.trim().toUpperCase()',
]) {
  if (!page.includes(fragment)) {
    throw new Error(`Missing canonical fee-schedule code contract: ${fragment}`);
  }
}

if (page.includes('<Input label="CPT Code"')) {
  throw new Error("Fee schedule rate entry still uses the disconnected free-text CPT input.");
}

console.log("payer fee schedule canonical code contract passed");
