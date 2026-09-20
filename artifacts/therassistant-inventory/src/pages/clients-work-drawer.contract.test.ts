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
  "Patient Address Line 1 *",
  "Patient City *",
  "Patient State *",
  "Patient ZIP Code *",
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
  "Primary Subscriber Address Line 1 *",
  "Primary Subscriber City *",
  "Primary Subscriber State *",
  "Primary Subscriber ZIP Code *",
  "Secondary Insurance",
  "Secondary Insurance Company",
  "Secondary Insurance ID",
  "Secondary Patient Relation to Subscriber",
  "Secondary Subscriber Address Line 1 *",
  "Secondary Subscriber City *",
  "Secondary Subscriber State *",
  "Secondary Subscriber ZIP Code *",
  "Insurance & Subscriber Correction",
  "Enroll in Patient Portal",
]) if (!page.includes(fragment)) throw new Error(`Missing patient drawer contract: ${fragment}`);

for (const relationship of ['["self", "Self"]', '["spouse", "Spouse"]', '["child", "Child"]', '["step_child", "Step Child"]', '["grandchild", "Grandchild"]']) {
  if (!page.includes(relationship)) throw new Error(`Missing subscriber relationship option: ${relationship}`);
}
if (page.includes('position:"fixed"')) throw new Error("Patient form still uses centered fixed overlay.");
console.log("patient work drawer contract passed");
