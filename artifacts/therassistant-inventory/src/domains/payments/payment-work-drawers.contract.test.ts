import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "PaymentsPage.tsx"), "utf8");
const drawers = readFileSync(join(here, "payment-work-drawers.tsx"), "utf8");
if (page.includes("window.prompt(")) throw new Error("Payments must not use browser prompts.");
for (const fragment of ["PostPaymentDrawer", "PaymentDetailDrawer", "ReversePaymentDrawer", "Insurance payment", "Patient payment", "Unapplied", "Trace number", "Check number", "Reversal reason", "Allocate Payment", "Remaining unapplied", "allocations:"]) {
  if (!drawers.includes(fragment)) throw new Error(`Missing payment drawer contract: ${fragment}`);
}
for (const fragment of ["queuePosition", "onPrevious", "onNext"]) {
  if (!page.includes(fragment)) throw new Error(`PaymentsPage missing queue navigation fragment: ${fragment}`);
}
console.log("payment work drawer contract passed");
