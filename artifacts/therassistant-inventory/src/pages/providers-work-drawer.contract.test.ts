import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)); const page = readFileSync(join(here, "providers.tsx"), "utf8");
for (const fragment of ["WorkDrawer", "Add Provider", "Edit Provider", "Open Provider Detail", "dirty="]) if (!page.includes(fragment)) throw new Error(`Missing provider drawer contract: ${fragment}`);
if (page.includes('position:"fixed"')) throw new Error("Provider form still uses centered fixed overlay.");
console.log("provider work drawer contract passed");
