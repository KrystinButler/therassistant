export type AgingBucket = "0-30" | "31-60" | "61-90" | "91-120" | "120+";

function utcDay(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.getTime();
}

export function daysOutstanding(serviceDate: string, asOfDate = new Date().toISOString().slice(0, 10)) {
  return Math.max(0, Math.floor((utcDay(asOfDate) - utcDay(serviceDate)) / 86_400_000));
}

export function agingBucket(serviceDate: string, asOfDate = new Date().toISOString().slice(0, 10)): AgingBucket {
  const days = daysOutstanding(serviceDate, asOfDate);
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  if (days <= 120) return "91-120";
  return "120+";
}

export function calculateOpenBalance(chargeCents: number, paidCents: number, adjustmentCents: number) {
  return Math.max(0, chargeCents - paidCents - adjustmentCents);
}
