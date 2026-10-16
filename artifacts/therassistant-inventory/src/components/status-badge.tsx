import { label } from "../lib/format";

type Props = {
  value?: string | null;
  domain?: "session" | "note" | "billing" | "checkin";
};

function tone(value: string): string {
  const normalized = value.toLowerCase();

  if (normalized.includes("incomplete") || normalized === "not_ready") return "thera-badge-warning";

  if (
    normalized.includes("paid") ||
    normalized.includes("complete") ||
    normalized.includes("ready") ||
    normalized.includes("active") ||
    normalized.includes("signed") ||
    normalized.includes("accepted")
  ) {
    return "thera-badge-success";
  }

  if (
    normalized.includes("denied") ||
    normalized.includes("failed") ||
    normalized.includes("blocked") ||
    normalized.includes("urgent")
  ) {
    return "thera-badge-danger";
  }

  if (
    normalized.includes("review") ||
    normalized.includes("pending") ||
    normalized.includes("appeal") ||
    normalized.includes("high") ||
    normalized.includes("authorization")
  ) {
    return "thera-badge-warning";
  }

  return "thera-badge-neutral";
}

export function StatusBadge({
  value, domain,
}: Props) {
  const status = value || "unknown";

  const labels: Record<string, Record<string, string>> = {
    session: { in_progress: "Session in progress", completed: "Session completed" },
    note: { draft: "Note draft", in_progress: "Note draft", signed: "Note signed", locked: "Note signed" },
    billing: { not_ready: "Billing incomplete", ready: "Ready for billing", ready_for_claim: "Ready for billing" },
    checkin: { ready: "Check-in submitted", submitted: "Check-in submitted", not_ready: "Check-in incomplete" },
  };
  return (
    <span className={`thera-badge ${tone(status)}`}>
      {domain ? labels[domain][status] ?? label(status) : label(status)}
    </span>
  );
}
