import {
  getAccessToken,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "./supabase-client";
import type { FetchLike } from "./tenant-data-client";

const MAILROOM_BUCKET = "therassistant-documents";
const CLAIM_EDI_BUCKET = "claim-edis";

function encodeStoragePath(path: string) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function responseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

function errorMessage(body: Record<string, unknown> | null, fallback: string) {
  return String(body?.message ?? body?.error ?? body?.error_description ?? fallback);
}

export function resolveStorageSignedUrl(signedUrl: string, baseUrl = SUPABASE_URL) {
  const signed = signedUrl.trim();
  if (!signed) throw new Error("Supabase Storage returned an empty signed URL.");
  if (/^https?:\/\//i.test(signed)) return signed;

  const path = signed.startsWith("/") ? signed : `/${signed}`;
  const storagePath = path.startsWith("/storage/v1/")
    ? path
    : `/storage/v1${path}`;

  return new URL(storagePath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

export function sanitizeStorageFileName(fileName: string) {
  const base = fileName.split(/[\\/]/).pop()?.trim() || "document";
  const dot = base.lastIndexOf(".");
  const rawStem = dot > 0 ? base.slice(0, dot) : base;
  const rawExtension = dot > 0 ? base.slice(dot + 1) : "";
  const stem = rawStem
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 _-]+/g, "")
    .trim()
    .replace(/[ _-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "document";
  const extension = rawExtension.replace(/[^A-Za-z0-9]+/g, "");
  return extension ? `${stem}.${extension}` : stem;
}

export function createStorageClient(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  tokenProvider: () => Promise<string | null> = getAccessToken,
) {
  async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
    const token = await tokenProvider();
    if (!token) throw new Error("Authentication is required.");
    const headers = new Headers(init.headers);
    headers.set("apikey", SUPABASE_PUBLISHABLE_KEY);
    headers.set("Authorization", `Bearer ${token}`);
    return fetchImpl(input, { ...init, headers });
  }

  async function uploadMailroomFile(input: {
    tenantId: string;
    mailroomItemId: string;
    file: Blob;
    fileName: string;
    contentType?: string;
  }) {
    const safeFileName = sanitizeStorageFileName(input.fileName);
    const path = `${input.tenantId}/mailroom/${input.mailroomItemId}/${safeFileName}`;
    const url = `${SUPABASE_URL}/storage/v1/object/${MAILROOM_BUCKET}/${encodeStoragePath(path)}`;
    const response = await authFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": input.contentType || input.file.type || "application/octet-stream",
        "x-upsert": "false",
      },
      body: input.file,
    });
    const body = await responseBody(response);
    if (!response.ok) throw new Error(errorMessage(body, `Storage upload failed (${response.status}).`));
    return { path };
  }

  async function uploadCredentialingFile(input: {
    tenantId: string;
    recordType: string;
    recordId: string;
    file: Blob;
    fileName: string;
    contentType?: string;
  }) {
    const safeFileName = sanitizeStorageFileName(input.fileName);
    const safeRecordType = input.recordType.replace(/[^A-Za-z0-9_-]+/g, "");
    const safeRecordId = input.recordId.replace(/[^A-Za-z0-9_-]+/g, "");
    if (!safeRecordType || !safeRecordId) {
      throw new Error("Credentialing document scope is invalid.");
    }
    const path = `${input.tenantId}/credentialing/${safeRecordType}/${safeRecordId}/${safeFileName}`;
    const url = `${SUPABASE_URL}/storage/v1/object/${MAILROOM_BUCKET}/${encodeStoragePath(path)}`;
    const response = await authFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": input.contentType || input.file.type || "application/octet-stream",
        "x-upsert": "false",
      },
      body: input.file,
    });
    const body = await responseBody(response);
    if (!response.ok) throw new Error(errorMessage(body, `Storage upload failed (${response.status}).`));
    return { path };
  }

  async function createSignedClaimEdiUrl(path: string, expiresIn = 300) {
    const url = `${SUPABASE_URL}/storage/v1/object/sign/${CLAIM_EDI_BUCKET}/${encodeStoragePath(path)}`;
    const response = await authFetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn }),
    });
    const body = await responseBody(response);
    if (!response.ok) throw new Error(errorMessage(body, `Unable to create signed EDI URL (${response.status}).`));
    const signed = String(body?.signedURL ?? body?.signedUrl ?? "");
    if (!signed) throw new Error("Supabase Storage returned no signed EDI URL.");
    return resolveStorageSignedUrl(signed);
  }

  async function readClaimEdiArtifact(path: string) {
    const signedUrl = await createSignedClaimEdiUrl(path, 60);
    const response = await fetchImpl(signedUrl);
    if (!response.ok) throw new Error(`Unable to read archived EDI artifact (${response.status}).`);
    return response.text();
  }

  async function uploadClaimEdiArtifact(input: {
    tenantId: string;
    batchId: string;
    fileName: string;
    text: string;
  }) {
    const safeFileName = input.fileName.replace(/[^A-Za-z0-9._-]+/g, "");
    if (!safeFileName || safeFileName !== input.fileName) throw new Error("Reserved EDI filename is invalid.");
    const expectedPath = `${input.tenantId}/outbound/837p/${input.batchId}/${safeFileName}`;
    const url = `${SUPABASE_URL}/storage/v1/object/${CLAIM_EDI_BUCKET}/${encodeStoragePath(expectedPath)}`;
    const response = await authFetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "x-upsert": "false" },
      body: input.text,
    });
    const body = await responseBody(response);
    if (!response.ok) {
      const message = errorMessage(body, `EDI archive upload failed (${response.status}).`);
      const duplicate = response.status === 409 || /duplicate|already exists|resource exists/i.test(message);
      if (!duplicate) throw new Error(message);
      const existing = await readClaimEdiArtifact(expectedPath);
      if (existing !== input.text) throw new Error("An immutable EDI artifact already exists for this batch but its contents differ.");
      return { path: expectedPath, existed: true };
    }
    return { path: expectedPath, existed: false };
  }
  async function createSignedDocumentUrl(path: string, expiresIn = 300) {
    const url = `${SUPABASE_URL}/storage/v1/object/sign/${MAILROOM_BUCKET}/${encodeStoragePath(path)}`;
    const response = await authFetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn }),
    });
    const body = await responseBody(response);
    if (!response.ok) throw new Error(errorMessage(body, `Unable to create signed document URL (${response.status}).`));
    const signed = String(body?.signedURL ?? body?.signedUrl ?? "");
    if (!signed) throw new Error("Supabase Storage returned no signed document URL.");
    return resolveStorageSignedUrl(signed);
  }

  async function deleteObject(path: string) {
    const url = `${SUPABASE_URL}/storage/v1/object/${MAILROOM_BUCKET}`;
    const response = await authFetch(url, {
      method: "DELETE",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [path] }),
    });
    const body = await responseBody(response);
    if (!response.ok) throw new Error(errorMessage(body, `Storage cleanup failed (${response.status}).`));
  }

  return { uploadMailroomFile, uploadCredentialingFile, uploadClaimEdiArtifact, readClaimEdiArtifact, createSignedClaimEdiUrl, createSignedDocumentUrl, deleteObject };
}

export const storageClient = createStorageClient();
