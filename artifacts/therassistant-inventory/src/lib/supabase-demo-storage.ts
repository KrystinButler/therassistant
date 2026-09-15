import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  type FetchLike,
} from "./supabase-demo-client";

const MAILROOM_BUCKET = "therassistant-documents";

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

export function createDemoStorage(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
) {
  const commonHeaders = { apikey: SUPABASE_PUBLISHABLE_KEY };

  async function uploadMailroomFile(input: {
    tenantId: string;
    mailroomItemId: string;
    file: Blob;
    fileName: string;
    contentType?: string;
  }) {
    const safeFileName = sanitizeStorageFileName(input.fileName);
    const path = `demo/${input.tenantId}/mailroom/${input.mailroomItemId}/${safeFileName}`;
    const url = `${SUPABASE_URL}/storage/v1/object/${MAILROOM_BUCKET}/${encodeStoragePath(path)}`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        ...commonHeaders,
        "Content-Type": input.contentType || input.file.type || "application/octet-stream",
        "x-upsert": "false",
      },
      body: input.file,
    });
    const body = await responseBody(response);
    if (!response.ok) {
      throw new Error(errorMessage(body, `Storage upload failed (${response.status}).`));
    }
    return { path };
  }

  async function createSignedDocumentUrl(path: string, expiresIn = 300) {
    const url = `${SUPABASE_URL}/storage/v1/object/sign/${MAILROOM_BUCKET}/${encodeStoragePath(path)}`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        ...commonHeaders,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn }),
    });
    const body = await responseBody(response);
    if (!response.ok) {
      throw new Error(errorMessage(body, `Unable to create signed document URL (${response.status}).`));
    }
    const signed = String(body?.signedURL ?? body?.signedUrl ?? "");
    if (!signed) throw new Error("Supabase Storage returned no signed document URL.");
    return signed.startsWith("http") ? signed : new URL(signed, SUPABASE_URL).toString();
  }

  async function deleteObject(path: string) {
    const url = `${SUPABASE_URL}/storage/v1/object/${MAILROOM_BUCKET}`;
    const response = await fetchImpl(url, {
      method: "DELETE",
      headers: {
        ...commonHeaders,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: [path] }),
    });
    const body = await responseBody(response);
    if (!response.ok) {
      throw new Error(errorMessage(body, `Storage cleanup failed (${response.status}).`));
    }
  }

  return {
    uploadMailroomFile,
    createSignedDocumentUrl,
    deleteObject,
  };
}

export const demoStorage = createDemoStorage();
