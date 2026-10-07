import test from "node:test";
import assert from "node:assert/strict";
import { safeTelehealthUrl } from "../src/domains/scheduling/telehealth-link";
test("video links require HTTPS and reject embedded credentials or script URLs", () => {
 assert.equal(safeTelehealthUrl("https://video.example.test/visit/123"), "https://video.example.test/visit/123");
 for (const value of ["javascript:alert(1)", "http://video.example.test", "https://name:password@example.test", "", null]) assert.equal(safeTelehealthUrl(value), null);
});
