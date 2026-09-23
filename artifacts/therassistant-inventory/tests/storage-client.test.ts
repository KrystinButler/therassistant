import test from "node:test";
import assert from "node:assert/strict";

import {
  createStorageClient,
  resolveStorageSignedUrl,
  sanitizeStorageFileName,
} from "../src/lib/storage-client.ts";

type Call = { url: string; init?: RequestInit };

function response(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const token = async () => "staff-access-token";

test("Mailroom upload uses the tenant root and authenticated Storage headers", async () => {
  const calls: Call[] = [];
  const storage = createStorageClient(async (input, init) => {
    calls.push({ url: String(input), init });
    return response({ Key: "tenant-1/mailroom/mail-1/My-Records-1.pdf" });
  }, token);

  const file = new Blob(["pdf"], { type: "application/pdf" });
  const result = await storage.uploadMailroomFile({
    tenantId: "tenant-1",
    mailroomItemId: "mail-1",
    file,
    fileName: "../../My Records (1)?.pdf",
    contentType: "application/pdf",
  });

  assert.equal(sanitizeStorageFileName("../../My Records (1)?.pdf"), "My-Records-1.pdf");
  assert.equal(result.path, "tenant-1/mailroom/mail-1/My-Records-1.pdf");
  assert.match(calls[0].url, /\/storage\/v1\/object\/therassistant-documents\/tenant-1\/mailroom\/mail-1\/My-Records-1\.pdf$/);
  const headers = new Headers(calls[0].init?.headers);
  assert.ok(headers.get("apikey"));
  assert.equal(headers.get("Authorization"), "Bearer staff-access-token");
  assert.equal(headers.get("Content-Type"), "application/pdf");
  assert.equal(headers.get("x-upsert"), "false");
  assert.equal(calls[0].init?.body, file);
});

test("Mailroom upload reports Storage API failures", async () => {
  const storage = createStorageClient(async () => response({ message: "Upload denied" }, 403), token);
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

test("relative Supabase Storage signed URLs are resolved through /storage/v1", () => {
  assert.equal(
    resolveStorageSignedUrl(
      "/object/sign/claim-edis/tenant-1/outbound/837p/batch-1/file.837?token=signed-token",
      "http://127.0.0.1:54321",
    ),
    "http://127.0.0.1:54321/storage/v1/object/sign/claim-edis/tenant-1/outbound/837p/batch-1/file.837?token=signed-token",
  );

  assert.equal(
    resolveStorageSignedUrl(
      "/storage/v1/object/sign/therassistant-documents/tenant-1/mailroom/item-1/file.pdf?token=signed-token",
      "https://example.supabase.co",
    ),
    "https://example.supabase.co/storage/v1/object/sign/therassistant-documents/tenant-1/mailroom/item-1/file.pdf?token=signed-token",
  );

  assert.equal(
    resolveStorageSignedUrl(
      "https://cdn.example.test/object/sign/file?token=signed-token",
      "https://example.supabase.co",
    ),
    "https://cdn.example.test/object/sign/file?token=signed-token",
  );
});

test("claim EDI signed URL accepts Storage's /object/sign response form", async () => {
  const storage = createStorageClient(async () => response({
    signedURL: "/object/sign/claim-edis/tenant-1/outbound/837p/batch-1/file.837?token=signed-token",
  }), token);

  const signed = await storage.createSignedClaimEdiUrl(
    "tenant-1/outbound/837p/batch-1/file.837",
    60,
  );

  assert.match(signed, /\/storage\/v1\/object\/sign\/claim-edis\//);
  assert.match(signed, /token=signed-token/);
});

test("private document open returns a short-lived signed URL", async () => {
  const calls: Call[] = [];
  const storage = createStorageClient(async (input, init) => {
    calls.push({ url: String(input), init });
    return response({
      signedURL: "/storage/v1/object/sign/therassistant-documents/tenant-1/mailroom/mail-1/notice.pdf?token=signed-token",
    });
  }, token);

  const signed = await storage.createSignedDocumentUrl(
    "tenant-1/mailroom/mail-1/notice.pdf",
    300,
  );

  assert.match(calls[0].url, /\/storage\/v1\/object\/sign\/therassistant-documents\/tenant-1\/mailroom\/mail-1\/notice\.pdf$/);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { expiresIn: 300 });
  assert.match(signed, /token=signed-token/);
  assert.doesNotMatch(signed, /\/object\/public\//);
});

test("cleanup deletes only the exact uploaded object path", async () => {
  const calls: Call[] = [];
  const storage = createStorageClient(async (input, init) => {
    calls.push({ url: String(input), init });
    return response({ message: "success" });
  }, token);

  const path = "tenant-1/mailroom/mail-1/notice.pdf";
  await storage.deleteObject(path);
  assert.equal(calls[0].init?.method, "DELETE");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { prefixes: [path] });
});


test("Credentialing upload uses the tenant credentialing root and sanitized file name", async () => {
  const calls: Call[] = [];
  const storage = createStorageClient(async (input, init) => {
    calls.push({ url: String(input), init });
    return response({ Key: "tenant-1/credentialing/enrollment/enroll-1/Network-Proof.pdf" });
  }, token);

  const file = new Blob(["proof"], { type: "application/pdf" });
  const result = await storage.uploadCredentialingFile({
    tenantId: "tenant-1",
    recordType: "enrollment",
    recordId: "enroll-1",
    file,
    fileName: "../Network Proof?.pdf",
    contentType: "application/pdf",
  });

  assert.equal(result.path, "tenant-1/credentialing/enrollment/enroll-1/Network-Proof.pdf");
  assert.match(
    calls[0].url,
    /\/storage\/v1\/object\/therassistant-documents\/tenant-1\/credentialing\/enrollment\/enroll-1\/Network-Proof\.pdf$/,
  );
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer staff-access-token");
  assert.equal(headers.get("x-upsert"), "false");
});
