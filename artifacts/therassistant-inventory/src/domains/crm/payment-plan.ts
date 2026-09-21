export type PlanFrequency = "weekly" | "biweekly" | "monthly";

export type InstallmentScheduleRow = {
  sequence: number;
  dueDate: string;
  amountCents: number;
};

export type AllocatableInstallment = {
  id: string;
  sequence: number;
  dueDate: string;
  amountDueCents: number;
  amountPaidCents: number;
  status: string;
};

function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Date must be YYYY-MM-DD.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Invalid date.");
  }
  return date;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthlyDate(first: Date, offset: number) {
  const anchorDay = first.getUTCDate();
  const base = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + offset, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(anchorDay, lastDay));
  return base;
}

export function buildInstallmentSchedule(input: {
  remainingBalanceCents: number;
  installmentCents: number;
  frequency: PlanFrequency;
  firstDueDate: string;
}): InstallmentScheduleRow[] {
  const { remainingBalanceCents, installmentCents, frequency, firstDueDate } = input;
  if (!Number.isInteger(remainingBalanceCents) || remainingBalanceCents <= 0) throw new Error("Remaining balance must be a positive integer number of cents.");
  if (!Number.isInteger(installmentCents) || installmentCents <= 0) throw new Error("Installment amount must be a positive integer number of cents.");
  if (!["weekly", "biweekly", "monthly"].includes(frequency)) throw new Error("Invalid payment frequency.");
  const first = parseIsoDate(firstDueDate);
  const schedule: InstallmentScheduleRow[] = [];
  let remaining = remainingBalanceCents;
  let sequence = 1;
  while (remaining > 0) {
    const amountCents = Math.min(installmentCents, remaining);
    let due: Date;
    if (frequency === "monthly") due = monthlyDate(first, sequence - 1);
    else {
      const days = (frequency === "weekly" ? 7 : 14) * (sequence - 1);
      due = new Date(first.getTime() + days * 86_400_000);
    }
    schedule.push({ sequence, dueDate: isoDate(due), amountCents });
    remaining -= amountCents;
    sequence += 1;
  }
  return schedule;
}

export function allocatePaymentOldestDueFirst(input: { paymentCents: number; installments: AllocatableInstallment[] }) {
  if (!Number.isInteger(input.paymentCents) || input.paymentCents <= 0) throw new Error("Payment must be positive integer cents.");
  let remaining = input.paymentCents;
  const allocations: Array<{ installmentId: string; amountCents: number }> = [];
  const eligible = [...input.installments]
    .filter((row) => row.status !== "waived" && row.amountPaidCents < row.amountDueCents)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence);
  for (const installment of eligible) {
    if (remaining <= 0) break;
    const due = Math.max(0, installment.amountDueCents - installment.amountPaidCents);
    const amountCents = Math.min(due, remaining);
    if (amountCents > 0) {
      allocations.push({ installmentId: installment.id, amountCents });
      remaining -= amountCents;
    }
  }
  return { allocations, unallocatedCents: remaining };
}
