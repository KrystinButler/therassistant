import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clinicalCss = readFileSync(new URL("../src/clinical-workspace-refresh.css", import.meta.url), "utf8");
const brandCss = readFileSync(new URL("../src/brand-system.css", import.meta.url), "utf8");

test("operational workspaces use the available desktop width", () => {
  assert.match(clinicalCss, /\.cw-content\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/s);
});

test("desktop navigation is compact enough for workflow-dense use", () => {
  assert.match(brandCss, /\.cw-nav-link\{[^}]*min-height:38px;/s);
  assert.match(brandCss, /\.cw-content\{padding:16px 18px 36px\}/s);
});
