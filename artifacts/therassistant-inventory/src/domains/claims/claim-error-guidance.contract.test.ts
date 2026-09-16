import { getClaimErrorGuidance } from "./claim-error-guidance";

const cases = [
  ["Service date is missing.", "service_date_from"],
  ["Claim charge must be greater than zero.", "total_charge_cents"],
  ["Claim line CPT/HCPCS is missing.", "claim_lines"],
  ["Claim line diagnosis pointer is missing.", "claim_lines"],
  ["At least one diagnosis is required.", "diagnoses"],
  ["Rendering provider is missing.", "rendering_provider"],
  ["Rendering provider is not approved with the payer.", "rendering_provider"],
  ["Payer is missing.", "payer"],
  ["Patient is missing.", "patient"],
] as const;

for (const [message, target] of cases) {
  const guidance = getClaimErrorGuidance(message);
  if (!guidance) throw new Error(`No guidance for ${message}`);
  if (guidance.target !== target) throw new Error(`${message}: expected ${target}, got ${guidance.target}`);
  if (!guidance.whatIsWrong || !guidance.whyItMatters || !guidance.correction || !guidance.actionLabel) throw new Error(`Incomplete guidance for ${message}`);
}
console.log("claim error guidance contract passed");
