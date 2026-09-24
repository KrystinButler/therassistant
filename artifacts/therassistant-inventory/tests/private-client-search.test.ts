import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const clients = readFileSync(new URL("../src/pages/clients.tsx", import.meta.url), "utf8");

test("global client search hands off privately without PHI in URL parameters", () => {
  assert.match(shell, /ClientSearchContext\.Provider/);
  assert.match(shell, /setSubmittedClientSearch/);
  assert.match(shell, /navigate\("\/clients"\)/);
  assert.doesNotMatch(shell, /action="\/clients" method="get"/);
  assert.match(clients, /useContext\(ClientSearchContext\)/);
  assert.doesNotMatch(clients, /URLSearchParams\(window\.location\.search\)/);
});
