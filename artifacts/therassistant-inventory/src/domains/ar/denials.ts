export type DenialPolicy = "workable" | "auto_writeoff" | "needs_review";

const AUTO_WRITEOFF_CARCS = new Set([
  "147", "170", "171", "172", "206", "207", "208", "242", "243", "279",
]);

function normalizeCarc(input: unknown) {
  return String(input ?? "").trim().toUpperCase().replace(/^(CO|PR|OA|PI)-/, "");
}

export function isAutoWriteoffCarc(carcCode?: unknown) {
  return isAutoWriteoffCarc(carcCode);
}

export function classifyDenialPolicy(category: unknown, carcCode?: unknown): DenialPolicy {
  const value = String(category ?? "other");
  if (["credentialing", "contracting"].includes(value) || AUTO_WRITEOFF_CARCS.has(normalizeCarc(carcCode))) return "auto_writeoff";
  if (["authorization", "eligibility", "coding", "documentation", "timely_filing", "medical_necessity", "coordination_of_benefits", "duplicate", "benefit_limit", "payer_processing_error"].includes(value)) return "workable";
  return "needs_review";
}

export function capDenialWriteOffAmount(denialAmountCents: number, openBalanceCents: number) {
  if (!Number.isFinite(denialAmountCents) || denialAmountCents < 0) throw new Error("Denial amount cannot be negative.");
  if (!Number.isFinite(openBalanceCents) || openBalanceCents < 0) throw new Error("Claim open balance cannot be negative.");
  return Math.min(denialAmountCents, openBalanceCents);
}

export function assertAppealAllowed(input: { category: unknown; carcCode?: unknown; hasActiveAppeal: boolean }) {
  if (classifyDenialPolicy(input.category, input.carcCode) === "auto_writeoff") {
    throw new Error("This denial category follows the configured non-workable/write-off policy and should not be appealed.");
  }
  if (input.hasActiveAppeal) throw new Error("An active appeal already exists for this denial.");
}

export function createAppealInput(
  denial: { id: string; claim_id?: unknown; denial_category?: unknown; carc_code?: unknown },
  level: number,
  dueDate: string,
  notes: string,
) {
  if (!denial.id) throw new Error("Denial is required.");
  if (!Number.isInteger(level) || level < 1) throw new Error("Appeal level must be 1 or greater.");
  assertAppealAllowed({ category: denial.denial_category, carcCode: denial.carc_code, hasActiveAppeal: false });
  return {
    denial_id: denial.id,
    claim_id: denial.claim_id ? String(denial.claim_id) : null,
    appeal_level: level,
    appeal_status: "drafting",
    deadline_date: dueDate || null,
    due_date: dueDate || null,
    notes: notes.trim() || null,
  };
}
