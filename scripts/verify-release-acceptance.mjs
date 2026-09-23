import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../release/acceptance.json", import.meta.url), "utf8"),
);
const errors = [];
const statusFields = ["implemented", "verified", "configured", "deployed", "closed"];

if (manifest.schema_version !== 2) {
  errors.push("schema_version must be 2.");
}
if (manifest.data_policy?.synthetic_test_scope !== "isolated_local_supabase_only") {
  errors.push("Synthetic test scope must remain isolated_local_supabase_only.");
}
if (manifest.data_policy?.production_test_data_created !== false) {
  errors.push("The manifest must state that production test data is not created.");
}
if (!manifest.production_baseline?.commit || !manifest.production_baseline?.deployment_id) {
  errors.push("Production baseline commit and deployment ID are required.");
}
if (
  manifest.production_baseline?.github_migration_count !==
  manifest.production_baseline?.database_migration_count
) {
  errors.push("GitHub and database migration counts must match.");
}
if (manifest.production_baseline?.migration_drift !== 0) {
  errors.push("Production migration drift must be zero.");
}
if (!Array.isArray(manifest.requirements) || manifest.requirements.length === 0) {
  errors.push("At least one release requirement is required.");
}

for (const requirement of manifest.requirements ?? []) {
  if (!requirement.id || typeof requirement.id !== "string") {
    errors.push("Every release requirement must have a string id.");
    continue;
  }
  for (const field of statusFields) {
    if (typeof requirement[field] !== "boolean") {
      errors.push(requirement.id + ": " + field + " must be boolean.");
    }
  }
  if (!Array.isArray(requirement.evidence) || requirement.evidence.length === 0) {
    errors.push(requirement.id + ": observable evidence is required.");
  }
  if (
    requirement.closed === true &&
    ["implemented", "verified", "configured", "deployed"].some(
      (field) => requirement[field] !== true,
    )
  ) {
    errors.push(
      requirement.id +
        ": closed=true requires implemented, verified, configured, and deployed.",
    );
  }
}

if (
  manifest.release_closed === true &&
  (manifest.requirements ?? []).some((requirement) => requirement.closed !== true)
) {
  errors.push("release_closed=true is invalid while any requirement remains open.");
}

if (errors.length) {
  for (const error of errors) console.error("RELEASE ACCEPTANCE ERROR: " + error);
  process.exit(1);
}

const open = manifest.requirements.filter((requirement) => !requirement.closed);
console.log(
  "Release acceptance evidence valid: " +
    (manifest.requirements.length - open.length) +
    " closed, " +
    open.length +
    " open.",
);
for (const requirement of open) console.log("OPEN: " + requirement.id);
