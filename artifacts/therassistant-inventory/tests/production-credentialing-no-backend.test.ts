import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pagePath = join(here, "../src/domains/credentialing/CredentialingPage.tsx");

test("production credentialing does not call the retired local API backend", () => {
  const source = readFileSync(pagePath, "utf8");

  assert.doesNotMatch(source, /\/api\/credentialing\//);
  assert.match(source, /tenantRpc|tenantUpdate/);
});
