export function patientRevenueTarget(kind: "payment" | "denial" | "appeal", recordId: string): string {
  if (!recordId.trim()) throw new Error("A revenue-cycle record ID is required.");
  const base = kind === "payment" ? "/payments" : "/denials";
  return `${base}?${kind}=${encodeURIComponent(recordId)}`;
}
