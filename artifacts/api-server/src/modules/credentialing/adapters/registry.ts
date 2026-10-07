import type { PayerAdapter } from "./types";

const payerAdapters = new Map<string, PayerAdapter>();

export function registerPayerAdapter(adapter: PayerAdapter): void {
  const key = adapter.key.trim();
  if (!key) throw new Error("Payer adapter key is required");
  payerAdapters.set(key, adapter);
}

export function getPayerAdapter(key: string): PayerAdapter | null {
  return payerAdapters.get(key.trim()) ?? null;
}

export function listPayerAdapters(): PayerAdapter[] {
  return [...payerAdapters.values()];
}

export function clearPayerAdaptersForTest(): void {
  payerAdapters.clear();
}
