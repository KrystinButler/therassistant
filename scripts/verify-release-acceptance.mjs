import { readFileSync } from "node:fs";

const path = new URL("../release/acceptance.json", import.meta.url);
const manifest = JSON.parse(readFileSync(path, "utf8"));
const errors = [];

if (!Array.isArray(manifest.requirements) || manifest.requirements.length === 0) {
  errors.push("release/acceptance.json must contain at least one requirement.");
}

const statusFields = ["implemented", "verified", "configured", "deployed", "closed"];

for (const requirement of manifest.requirements ?? []) {
  if (!requirement.id || typeof requirement.id !== "string") {
    errors.push("Every release requirement must have a string id.");
    continue;
  }

  for (const field of statusFields) {
    if (typeof requirement[field] !== "boolean") {
      errors.push(`${requirement.id}: ${field} must be boolean.`);
    }
  }

  if (!Array.isArray(requirement.evidence) || requirement.evidence.length === 0) {
    errors.push(`${requirement.id}: observable evidence is required.`);
  }

  if (
    requirement.closed === true &&
    ["implemented", "verified", "configured", "deployed"].some(
      (field) => requirement[field] !== true,
    )
  ) {
    errors.push(
      `${requirement.id}: closed=true requires implemented, verified, configured, and deployed to all be true.`,
    );
  }
}

if (
  manifest.release_closed === true &&
  (manifest.requirements ?? []).some((requirement) => requirement.closed !== true)
) {
  errors.push("release_closed=true is invalid while any requirement remains open.");
}

if (errors.length > 0) {
  for (const error of errors) console.error(`RELEASE ACCEPTANCE ERROR: ${error}`);
  process.exit(1);
}

const open = manifest.requirements.filter((requirement) => !requirement.closed);
console.log(
  `Release acceptance evidence valid: ${manifest.requirements.length - open.length} closed, ${open.length} open.`,
);
for (const requirement of open) {
  console.log(`OPEN: ${requirement.id}`);
}
