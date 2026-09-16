import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "RejectionsPage.tsx"), "utf8");
const styles = readFileSync(join(here, "rejections-workqueue.css"), "utf8");

for (const fragment of [
  "Claim Rejection Workqueue",
  "Action Required",
  "In Correction",
  "Ready to Resubmit",
  "Resolved Today",
  "All Rejection Codes",
  "Rejection Resolution",
  "Correction Needed",
  "Why it matters",
  "Resubmit & Resolve",
  "rejections-workspace",
  "rejections-resolution",
]) {
  if (!page.includes(fragment) && !styles.includes(fragment)) {
    throw new Error(`Missing rejection workqueue UI contract: ${fragment}`);
  }
}

console.log("rejection workqueue UI contract passed");
