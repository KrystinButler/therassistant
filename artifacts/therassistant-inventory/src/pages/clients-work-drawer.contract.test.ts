import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "clients.tsx"), "utf8");

for (const fragment of [
  "WorkDrawer",
  "Add Patient",
  "Edit Patient",
  "Open Patient 360",
  "dirty=",
  "Patient Information",
  "Patient First Name *",
  "Patient Last Name *",
  "Patient DOB *",
  "Patient Sex *",
  "Patient Address *",
  "Patient Phone *",
  "Patient Email *",
  "Emergency Contact Name",
  "Emergency Contact Phone",
  "Emergency Contact Relation to Patient",
  "Primary Insurance",
  "Primary Insurance Company *",
  "Primary Insurance Plan",
  "Primary Insurance Product",
  "Primary Insurance ID *",
  "Primary Insurance Group #",
  "Primary Patient Relation to Subscriber *",
  "Secondary Insurance",
  "Secondary Insurance Company",
  "Secondary Insurance ID",
  "Secondary Patient Relation to Subscriber",
  "Enroll in Patient Portal",
]) if (!page.includes(fragment)) throw new Error(`Missing patient drawer contract: ${fragment}`);

if (!page.includes('value="self"') || !page.includes('value="spouse"') || !page.includes('value="child"') || !page.includes('value="parent"') || !page.includes('value="other"')) {
  throw new Error("Subscriber relationship dropdown options are incomplete.");
}
if (page.includes('position:"fixed"')) throw new Error("Patient form still uses centered fixed overlay.");
console.log("patient work drawer contract passed");
