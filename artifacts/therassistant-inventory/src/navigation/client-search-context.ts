import { createContext } from "react";

/** One-session search handoff avoids placing patient identifiers in URLs or access logs. */
export type ClientSearchRequest = { term: string; revision: number };
export const ClientSearchContext = createContext<ClientSearchRequest | null>(null);
