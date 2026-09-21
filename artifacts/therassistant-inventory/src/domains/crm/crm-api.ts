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
