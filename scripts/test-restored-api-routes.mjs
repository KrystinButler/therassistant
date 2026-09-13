const base =
  process.argv[2] ??
  "http://localhost:3001";

const endpoints = [
  "/api/health",
  "/api/demo-control/tenants",
  "/api/demo-control/status",
  "/api/medicaid",
  "/api/claim-submission",
  "/api/claim-follow-up",
  "/api/payments-overview",
  "/api/ar-denials",
  "/api/credentialing",
  "/api/payers-contracts",
  "/api/mailroom",
  "/api/imports",
  "/api/journal",
  "/api/reports",
  "/api/administration/compliance",
];

let failed = 0;

for (const endpoint of endpoints) {
  try {
    const response =
      await fetch(base + endpoint);

    if (response.status === 200) {
      console.log(
        `PASS ${endpoint}`
      );
    } else {
      console.log(
        `FAIL ${endpoint} HTTP ${response.status}`
      );

      failed++;
    }
  } catch (error) {
    console.log(
      `FAIL ${endpoint} ${error.message}`
    );

    failed++;
  }
}

if (failed) {
  console.error(
    `\n${failed} endpoint(s) failed.`
  );

  process.exit(1);
}

console.log(
  "\nAll restored API routes passed."
);
