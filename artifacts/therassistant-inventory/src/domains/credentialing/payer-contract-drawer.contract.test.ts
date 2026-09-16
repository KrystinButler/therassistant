import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "PayersContractsPage.tsx"), "utf8");
for (const fragment of ["WorkDrawer", "Add Contract", "Save Contract", "Open Full Payer Record", "newContractPayer"]) if (!page.includes(fragment)) throw new Error(`Missing payer contract drawer behavior: ${fragment}`);
if (page.includes('position: "fixed"') || page.includes('placeItems: "center"')) throw new Error("Payer contract creation must not use a centered overlay");
console.log("payer contract drawer contract passed");
