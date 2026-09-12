import { label } from "../lib/format";

type Props = {
  value?: string | null;
};

function tone(value: string): string {
  const normalized = value.toLowerCase();

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
  value,
}: Props) {
  const status = value || "unknown";

  return (
    <span className={`thera-badge ${tone(status)}`}>
      {label(status)}
    </span>
  );
}
