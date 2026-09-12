import fs from "node:fs";

const app =
  fs.readFileSync(
    "artifacts/therassistant-inventory/src/App.tsx",
    "utf8",
  );

const required = [
  "/demo",
  "/schedule",
  "/clinical",
  "/journal",
  "/eligibility",
  "/authorizations",
  "/medicaid",
  "/charges",
  "/claims/submission",
  "/claims/follow-up",
  "/payments",
  "/ar-denials",
  "/credentialing",
  "/payers-contracts",
  "/mailroom",
  "/reports",
  "/administration/imports",
];

let failed = false;

if (app.includes("ModulePlaceholder")) {
  console.log("FAIL active placeholders remain");
  failed = true;
} else {
  console.log("PASS no active placeholders");
}

for (const route of required) {
  if (app.includes(`path="${route}"`)) {
    console.log(`PASS ${route}`);
  } else {
    console.log(`FAIL ${route}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
