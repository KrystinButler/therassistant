import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";

const CRM_API_URL = SUPABASE_URL + "/functions/v1/crm-api";
const PAYMENT_API_URL = SUPABASE_URL + "/functions/v1/payment-desk-api";

type ApiOptions = {
  method?: "GET" | "POST";
  query?: Record<string, string | number | null | undefined>;
  body?: unknown;
};

async function callApi<T>(baseUrl:string, action:string, options:ApiOptions={}):Promise<T> {
  const url=new URL(baseUrl);
  url.searchParams.set("action", action);
  for (const [key,value] of Object.entries(options.query ?? {})) {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key,String(value));
  }
  const headers=new Headers();
  if (options.body !== undefined) headers.set("Content-Type","application/json");
  const response=await authenticatedFetch(url,{
    method:options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body:options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? ("Request failed ("+response.status+").")));
  return payload as T;
}

export function crmApi<T>(action:string, options:ApiOptions={}) {
  return callApi<T>(CRM_API_URL,action,options);
}

export function paymentDeskApi<T>(action:string, options:ApiOptions={}) {
  return callApi<T>(PAYMENT_API_URL,action,options);
}

export async function uploadCrmDocument(input:{
  accountId:string;
  file:File;
  category:string;
}) {
  const signed=await crmApi<{path:string;token:string;signedUrl:string}>("create-document-upload",{
    method:"POST",
    body:{accountId:input.accountId,fileName:input.file.name,mimeType:input.file.type,fileSize:input.file.size},
  });
  const form=new FormData();
  form.append("cacheControl","3600");
  form.append("",input.file);
  const uploadResponse=await fetch(signed.signedUrl,{method:"PUT",body:form});
  if(!uploadResponse.ok){
    const message=await uploadResponse.text().catch(()=>"");
    throw new Error(message || `Document upload failed (${uploadResponse.status}).`);
  }
  return crmApi<{document:unknown}>("finalize-document",{
    method:"POST",
    body:{
      accountId:input.accountId,
      storagePath:signed.path,
      displayName:input.file.name,
      mimeType:input.file.type,
      fileSize:input.file.size,
      category:input.category,
    },
  });
}

export async function getCrmDocumentDownloadUrl(documentId:string) {
  const result=await crmApi<{url:string;expiresIn:number}>("document-download",{
    method:"POST",
    body:{documentId},
  });
  return result.url;
}
