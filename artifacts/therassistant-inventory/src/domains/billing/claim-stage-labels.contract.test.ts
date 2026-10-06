import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "BillingQueuePage.tsx"), "utf8");

describe("insurance claim preparation stage labels", () => {
  test("keeps claim creation and claim scrub as separate user-facing stages", () => {
    expect(source).toContain('onClick={() => onCreateClaim(encounterId)}>Create Claim</button>');
    expect(source).toContain('onClick={() => onValidate(claim.id)}>Claim Scrub</button>');
    expect(source).not.toContain("Create & Scrub Claim");
    expect(source).not.toContain(">Scrub Claim</button>");
  });

  test("labels the second preparation stage Claim Scrub", () => {
    expect(source).toContain('["02", "Claim Scrub", "Review required claim fields and route true claim-content failures to Rejections."]');
  });
});
