import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "clients.tsx"), "utf8");
for (const fragment of ["WorkDrawer", "Add Patient", "Edit Patient", "Open Patient 360", "dirty="]) if (!page.includes(fragment)) throw new Error(`Missing patient drawer contract: ${fragment}`);
if (page.includes('position:"fixed"')) throw new Error("Patient form still uses centered fixed overlay.");
console.log("patient work drawer contract passed");
