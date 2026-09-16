import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "AuthorizationsPage.tsx"), "utf8");
const drawer = readFileSync(join(here, "authorization-work-drawer.tsx"), "utf8");
for (const fragment of ["AuthorizationWorkDrawer", "activeId", "Work"]) if (!page.includes(fragment)) throw new Error(`Missing authorization workspace behavior: ${fragment}`);
for (const fragment of ["WorkDrawer", "Authorization Number", "Units Remaining", "Needs Attention", "Open Patient Chart"]) if (!drawer.includes(fragment)) throw new Error(`Missing authorization drawer behavior: ${fragment}`);
console.log("authorization work drawer contract passed");
