import test from "node:test";
import assert from "node:assert/strict";

import {
  createDemoStorage,
  sanitizeStorageFileName,
} from "../src/lib/supabase-demo-storage.ts";

type Call = { url: string; init?: RequestInit };

function response(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Mailroom upload builds a scoped path and sanitizes the original filename", async () => {
  const calls: Call[] = [];
  const storage = createDemoStorage(async (input, init) => {
    calls.push({ url: String(input), init });
    return response({ Key: "demo/tenant-1/mailroom/mail-1/My-Records-1.pdf" });
  });

  const file = new Blob(["pdf"], { type: "application/pdf" });
  const result = await storage.uploadMailroomFile({
    tenantId: "tenant-1",
    mailroomItemId: "mail-1",
    file,
    fileName: "../../My Records (1)?.pdf",
    contentType: "application/pdf",
  });

  assert.equal(sanitizeStorageFileName("../../My Records (1)?.pdf"), "My-Records-1.pdf");
  assert.equal(result.path, "demo/tenant-1/mailroom/mail-1/My-Records-1.pdf");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/storage\/v1\/object\/therassistant-documents\/demo\/tenant-1\/mailroom\/mail-1\/My-Records-1\.pdf$/);
  assert.equal(calls[0].init?.method, "POST");
  const headers = new Headers(calls[0].init?.headers);
  assert.ok(headers.get("apikey"));
  assert.equal(headers.get("Content-Type"), "application/pdf");
  assert.equal(headers.get("x-upsert"), "false");
  assert.equal(calls[0].init?.body, file);
});

test("Mailroom upload reports Storage API failures", async () => {
  const storage = createDemoStorage(async () => response({ message: "Upload denied" }, 403));
  await assert.rejects(
    () => storage.uploadMailroomFile({
      tenantId: "tenant-1",
      mailroomItemId: "mail-1",
      file: new Blob(["x"]),
      fileName: "notice.pdf",
    }),
    /Upload denied/i,
  );
});

test("private document open returns a short-lived signed URL instead of a public URL", async () => {
  const calls: Call[] = [];
  const storage = createDemoStorage(async (input, init) => {
    calls.push({ url: String(input), init });
    return response({
      signedURL: "/storage/v1/object/sign/therassistant-documents/demo/tenant-1/mailroom/mail-1/notice.pdf?token=signed-token",
    });
  });

  const signed = await storage.createSignedDocumentUrl(
    "demo/tenant-1/mailroom/mail-1/notice.pdf",
    300,
  );

  assert.match(calls[0].url, /\/storage\/v1\/object\/sign\/therassistant-documents\/demo\/tenant-1\/mailroom\/mail-1\/notice\.pdf$/);
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { expiresIn: 300 });
  assert.match(signed, /token=signed-token/);
  assert.doesNotMatch(signed, /\/object\/public\//);
});

test("cleanup deletes only the exact uploaded object path", async () => {
  const calls: Call[] = [];
  const storage = createDemoStorage(async (input, init) => {
    calls.push({ url: String(input), init });
    return response({ message: "success" });
  });

  await storage.deleteObject("demo/tenant-1/mailroom/mail-1/notice.pdf");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, "DELETE");
  assert.match(calls[0].url, /\/storage\/v1\/object\/therassistant-documents\/demo\/tenant-1\/mailroom\/mail-1\/notice\.pdf$/);
});
