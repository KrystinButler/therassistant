type Row = Record<string, any> & { id: string };

function fullName(row?: Row | null) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

export function buildClientChartRelationships(input: {
  clientId: string;
  encounters: Row[];
  appointments: Row[];
  providers: Row[];
  payers: Row[];
  charges: Row[];
  claims: Row[];
  workItems: Row[];
}) {
  const providerMap = new Map(input.providers.map((row) => [row.id, row]));
  const payerMap = new Map(input.payers.map((row) => [row.id, row]));

  const clientAppointments = input.appointments.filter(
    (row) => row.client_id === input.clientId,
  );
  const appointmentIds = new Set(clientAppointments.map((row) => row.id));

  const clientEncounters = input.encounters
    .filter((row) => row.client_id === input.clientId)
    .map((encounter) => {
      const encounterCharges = input.charges.filter(
        (row) => row.encounter_id === encounter.id,
      );
      const encounterClaims = input.claims.filter(
        (row) => row.source_encounter_id === encounter.id,
      );
      const latestClaim = [...encounterClaims].sort((a, b) =>
        String(b.updated_at ?? b.created_at ?? "").localeCompare(
          String(a.updated_at ?? a.created_at ?? ""),
        ),
      )[0];

      return {
        ...encounter,
        providerName: fullName(providerMap.get(String(encounter.provider_id ?? ""))),
        payerName: String(payerMap.get(String(encounter.payer_id ?? ""))?.name ?? "—"),
        chargeCount: encounterCharges.length,
        claimCount: encounterClaims.length,
        latestClaimStatus: latestClaim ? String(latestClaim.claim_status ?? "") : null,
      };
    });

  const encounterIds = new Set(clientEncounters.map((row) => row.id));
  const chargeIds = new Set(
    input.charges
      .filter((row) => row.client_id === input.clientId || encounterIds.has(String(row.encounter_id ?? "")))
      .map((row) => row.id),
  );
  const claimIds = new Set(
    input.claims
      .filter((row) => row.client_id === input.clientId || encounterIds.has(String(row.source_encounter_id ?? "")))
      .map((row) => row.id),
  );

  const workItems = input.workItems.filter((row) => {
    const sourceId = String(row.source_object_id ?? "");
    const sourceType = String(row.source_object_type ?? "");
    if (sourceType === "client" && sourceId === input.clientId) return true;
    if (sourceType === "appointment" && appointmentIds.has(sourceId)) return true;
    if (sourceType === "encounter" && encounterIds.has(sourceId)) return true;
    if (sourceType === "charge" && chargeIds.has(sourceId)) return true;
    if (sourceType === "claim" && claimIds.has(sourceId)) return true;
    return false;
  });

  return { encounters: clientEncounters, workItems };
}
