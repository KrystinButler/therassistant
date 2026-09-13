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
  status: string;
  needsAttention: boolean;
  rawResponse: unknown;
};

export type AuthorizationQueueRow = {
  id: string;
  patientId: string;
  patientName: string;
  payerId: string | null;
  payerName: string;
  authorizationId: string | null;
  authorizationNumber: string | null;
  status: string;
  endDate: string | null;
  remainingUnits: number | null;
  alert: string;
  needsAttention: boolean;
};

type EligibilityQueueInput = {
  clients: QueueRow[];
  payers: QueueRow[];
  policies: QueueRow[];
  eligibility: QueueRow[];
};

type AuthorizationQueueInput = {
  clients: QueueRow[];
  payers: QueueRow[];
  policies: QueueRow[];
  authorizations: QueueRow[];
  units: QueueRow[];
  today?: string;
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

  return input.clients.map((client): EligibilityQueueRow => {
    const policy = primaryPolicy(input.policies, client.id);
    const latest = policy
      ? newest(
          input.eligibility.filter(
            (row) =>
              row.client_id === client.id &&
              row.insurance_policy_id === policy.id,
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
      status,
      needsAttention: !["active", "eligible"].includes(status),
      rawResponse: latest?.raw_response ?? null,
    };
  });
}

function currentAuthorization(
  rows: QueueRow[],
  patientId: string,
  payerId: string | null,
) {
  const relevant = rows.filter(
    (row) =>
      row.client_id === patientId &&
      (!payerId || !row.payer_id || String(row.payer_id) === payerId),
  );
  return [...relevant].sort((a, b) => {
    const aApproved = a.status === "approved";
    const bApproved = b.status === "approved";
    if (aApproved && !bApproved) return -1;
    if (bApproved && !aApproved) return 1;
    return String(b.end_date ?? b.created_at ?? "").localeCompare(
      String(a.end_date ?? a.created_at ?? ""),
    );
  })[0] ?? null;
}

export function buildAuthorizationQueue(input: AuthorizationQueueInput): AuthorizationQueueRow[] {
  const payerMap = new Map(input.payers.map((row) => [row.id, row]));
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const result: AuthorizationQueueRow[] = [];

  for (const client of input.clients) {
    const policy = primaryPolicy(input.policies, client.id);
    const payerId = policy?.payer_id ? String(policy.payer_id) : null;
    const required = metadata(policy).authorization_required === true;
    const authorization = currentAuthorization(
      input.authorizations,
      client.id,
      payerId,
    );

    if (!required && !authorization) continue;

    if (!authorization) {
      result.push({
        id: `authorization-missing-${client.id}`,
        patientId: client.id,
        patientName: patientName(client),
        payerId,
        payerName: payerId ? String(payerMap.get(payerId)?.name ?? "—") : "—",
        authorizationId: null,
        authorizationNumber: null,
        status: "missing",
        endDate: null,
        remainingUnits: null,
        alert: "missing",
        needsAttention: true,
      });
      continue;
    }

    const authUnits = input.units.filter(
      (row) => row.authorization_id === authorization.id,
    );
    const remainingUnits = authUnits.length
      ? authUnits.reduce((sum, row) => sum + Number(row.remaining_units ?? 0), 0)
      : null;
    const status = String(authorization.status ?? "unknown");
    const endDate = authorization.end_date ? String(authorization.end_date) : null;

    let alert = "current";
    if (status !== "approved") alert = status;
    else if (endDate && endDate < today) alert = "expired";
    else if (remainingUnits !== null && remainingUnits <= 0) alert = "exhausted";
    else if (remainingUnits !== null && remainingUnits <= 2) alert = "low_units";

    result.push({
      id: authorization.id,
      patientId: client.id,
      patientName: patientName(client),
      payerId,
      payerName: payerId ? String(payerMap.get(payerId)?.name ?? "—") : "—",
      authorizationId: authorization.id,
      authorizationNumber: authorization.authorization_number
        ? String(authorization.authorization_number)
        : null,
      status,
      endDate,
      remainingUnits,
      alert,
      needsAttention: alert !== "current",
    });
  }

  return result;
}
