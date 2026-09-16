import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)); const page = readFileSync(join(here, "MailroomPage.tsx"), "utf8"); const drawer = readFileSync(join(here, "mailroom-work-drawer.tsx"), "utf8");
for (const fragment of ["MailroomWorkDrawer", "Classification", "Link to patient", "Link to claim", "Link to payer", "Link to provider", "Create Work Item", "Mark Complete", "onNext", "Open Full Correspondence"]) if (!drawer.includes(fragment)) throw new Error(`Missing mailroom drawer contract: ${fragment}`);
if (!page.includes("MailroomWorkDrawer")) throw new Error("Mailroom inbox does not open correspondence in a drawer.");
console.log("mailroom work drawer contract passed");
