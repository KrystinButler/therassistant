import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const api=readFileSync(new URL("../src/domains/crm/crm-api.ts",import.meta.url),"utf8");
const detail=readFileSync(new URL("../src/domains/crm/AccountDetailPage.tsx",import.meta.url),"utf8");
test("document upload asks CRM API for signed upload and PUTs the file",()=>{assert.match(api,/create-document-upload/);assert.match(api,/signedUrl/);assert.match(api,/method:"PUT"/);assert.match(api,/finalize-document/);});
test("document download requests a fresh signed URL",()=>{assert.match(detail,/getCrmDocumentDownloadUrl|document-download/);assert.match(detail,/window\.open/);});
test("browser source contains no server secret or public bucket URL",()=>{assert.doesNotMatch(api,/service_role|sb_secret_/i);assert.doesNotMatch(api,/getPublicUrl|\/object\/public\//i);});
test("finalization verifies the uploaded object before saving metadata",()=>{const backend=readFileSync(new URL("../../../supabase/functions/crm-api/index.ts",import.meta.url),"utf8");assert.match(backend,/\.info\(storagePath\)/);assert.match(backend,/actualSize/);});
