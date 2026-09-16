import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)); const page = readFileSync(join(here, "SchedulePage.tsx"), "utf8");
for (const fragment of ["WorkDrawer", "New Appointment", "Edit Appointment", "updateAppointment", "dirty="]) if (!page.includes(fragment)) throw new Error(`Missing schedule drawer contract: ${fragment}`);
if (page.includes('position: "fixed"')) throw new Error("Schedule form still uses centered fixed overlay.");
console.log("schedule work drawer contract passed");
