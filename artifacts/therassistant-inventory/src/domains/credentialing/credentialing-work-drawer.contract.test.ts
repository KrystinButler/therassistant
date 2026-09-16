import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)); const page = readFileSync(join(here, "CredentialingPage.tsx"), "utf8");
for (const fragment of ["WorkDrawer", "Edit Enrollment", "Effective Date", "Revalidation Due", "Termination Date", "Payer Provider ID", "Enrollment workflow", "dirty="]) if (!page.includes(fragment)) throw new Error(`Missing credentialing drawer contract: ${fragment}`);
if (page.includes('position: "fixed"')) throw new Error("Credentialing edit still uses centered fixed overlay.");
console.log("credentialing work drawer contract passed");
