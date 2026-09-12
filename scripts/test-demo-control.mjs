import fs from "node:fs";

const required = [
  "scripts/reset-therassistant-demo.mjs",
  "scripts/verify-therassistant-demo.mjs",
  "artifacts/api-server/src/routes/demo-control.ts",
  "artifacts/therassistant-inventory/src/components/demo-top-controls.tsx",
  "artifacts/therassistant-inventory/src/pages/demo-control.tsx",
];

const missing =
  required.filter(
    (file) =>
      !fs.existsSync(file),
  );

if (missing.length) {
  console.error(
    "EXPECTED RED TEST:",
  );

  for (const file of missing) {
    console.error(
      ` - Missing ${file}`,
    );
  }

  process.exit(1);
}

console.log(
  "Demo-control files exist.",
);
