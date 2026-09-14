type Row = Record<string, any>;

function providerName(provider?: Row | null) {
  if (!provider) return "—";
  const name = [provider.first_name, provider.last_name].filter(Boolean).join(" ");
  return provider.credentials ? `${name}, ${provider.credentials}` : name;
}

export function buildPayer360View(input: {
  payerId: string;
  payers: Row[];
  plans: Row[];
  providers: Row[];
  enrollments: Row[];
  contracts: Row[];
  feeSchedules: Row[];
  feeScheduleLines: Row[];
}) {
  const payer = input.payers.find((row) => row.id === input.payerId);
  if (!payer) throw new Error("Payer not found.");

  const providerMap = new Map(input.providers.map((row) => [row.id, row]));
  const payerContracts = input.contracts.filter((row) => row.payer_id === input.payerId);

  return {
    payer,
    plans: input.plans.filter((row) => row.payer_id === input.payerId),
    enrolledProviders: input.enrollments
      .filter((row) => row.payer_id === input.payerId)
      .map((row) => ({
        ...row,
        providerName: providerName(providerMap.get(row.provider_id)),
      })),
    contracts: payerContracts.map((contract) => ({
      ...contract,
      feeSchedules: input.feeSchedules
        .filter((schedule) => schedule.payer_contract_id === contract.id)
        .map((schedule) => ({
          ...schedule,
          lines: input.feeScheduleLines.filter(
            (line) => line.fee_schedule_id === schedule.id,
          ),
        })),
    })),
  };
}
