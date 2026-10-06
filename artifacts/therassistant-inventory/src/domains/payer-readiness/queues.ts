import { isVerifiedEligibilitySource } from "../eligibility/workflow";

export type QueueRow = Record<string, unknown> & { id: string };

export type EligibilityQueueRow = {
  id: string;
  patientId: string;
  patientName: string;
  policyId: string | null;
  payerId: string | null;
  payerName: string;
  memberId: string;
  serviceDate: string | null;
  checkedAt: string | null;
  responseSource: string | null;
  status: string;
  needsAttention: boolean;
  rawResponse: unknown;
};

type EligibilityQueueInput = {
  clients: QueueRow[];
  payers: QueueRow[];
  policies: QueueRow[];
  eligibility: QueueRow[];
};

function patientName(row?: QueueRow | null) {
  if (!row) return "—";
  const preferred = String(row.preferred_name ?? "").trim();
  const first = preferred || String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  return [first, last].filter(Boolean).join(" ") || "—";
}

function primaryPolicy(policies: QueueRow[], patientId: string) {
  const rows = policies.filter((row) => row.client_id === patientId);
  return (
    rows.find((row) => row.status === "active" && row.insurance_order === "primary") ??
    rows.find((row) => row.status === "active") ??
    rows[0] ??
    null
  );
}

function metadata(row?: QueueRow | null) {
  return row?.metadata && typeof row.metadata === "object"
    ? (row.metadata as Record<string, unknown>)
    : {};
}

function newest(rows: QueueRow[]) {
  return [...rows].sort((a, b) => {
    const bKey = String(b.created_at ?? b.updated_at ?? b.service_date ?? "");
    const aKey = String(a.created_at ?? a.updated_at ?? a.service_date ?? "");
    return bKey.localeCompare(aKey);
  })[0] ?? null;
}

export function buildEligibilityQueue(input: EligibilityQueueInput): EligibilityQueueRow[] {
  const payerMap = new Map(input.payers.map((row) => [row.id, row]));

  return input.clients
    .filter((client) => String(metadata(client).billing_type ?? "insurance") !== "self_pay")
    .map((client): EligibilityQueueRow => {
    const policy = primaryPolicy(input.policies, client.id);
    const latest = policy
      ? newest(
          input.eligibility.filter(
            (row) =>
              row.client_id === client.id &&
              row.insurance_policy_id === policy.id &&
              isVerifiedEligibilitySource(row.response_source),
          ),
        )
      : null;
    const status = policy ? String(latest?.eligibility_status ?? "not_checked") : "missing_insurance";
    const payer = policy ? payerMap.get(String(policy.payer_id ?? "")) : null;

    return {
      id: `eligibility-${client.id}`,
      patientId: client.id,
      patientName: patientName(client),
      policyId: policy?.id ?? null,
      payerId: policy ? String(policy.payer_id ?? "") || null : null,
      payerName: String(payer?.name ?? "—"),
      memberId: String(policy?.member_id ?? ""),
      serviceDate: latest?.service_date ? String(latest.service_date) : null,
      checkedAt: latest?.created_at ? String(latest.created_at) : null,
      responseSource: latest?.response_source ? String(latest.response_source) : null,
      status,
      needsAttention: !["active", "eligible"].includes(status),
      rawResponse: latest?.raw_response ?? null,
    };
  });
}
