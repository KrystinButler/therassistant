import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "EligibilityPage.tsx"), "utf8");
const drawer = readFileSync(join(here, "eligibility-work-drawer.tsx"), "utf8");
for (const fragment of ["EligibilityWorkDrawer", "activeId", "Needs Attention"]) if (!page.includes(fragment)) throw new Error(`Missing eligibility workspace behavior: ${fragment}`);
for (const fragment of ["WorkDrawer", "Member ID", "Coverage Status", "Run Eligibility", "Open Patient Chart"]) if (!drawer.includes(fragment)) throw new Error(`Missing eligibility drawer behavior: ${fragment}`);
console.log("eligibility work drawer contract passed");
