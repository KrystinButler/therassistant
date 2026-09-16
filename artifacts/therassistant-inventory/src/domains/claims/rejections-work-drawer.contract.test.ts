import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "RejectionsPage.tsx"), "utf8");
const drawer = readFileSync(join(here, "claim-work-drawer.tsx"), "utf8");

for (const fragment of ['mode="rejection"', 'initialSection="rejections"']) {
  if (!page.includes(fragment)) throw new Error(`RejectionsPage missing focused drawer fragment: ${fragment}`);
}
for (const fragment of ['mode?: "claims" | "rejection"', 'Resubmit Claim', 'Save Draft']) {
  if (!drawer.includes(fragment)) throw new Error(`ClaimWorkDrawer missing rejection workflow fragment: ${fragment}`);
}

console.log("rejections focused drawer contract passed");
