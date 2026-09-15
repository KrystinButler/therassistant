export type DemoScenario = {
  title: string;
  name: string;
  detail: string;
  href: string;
};

export const phase1DemoScenarios: DemoScenario[] = [
  {
    title: "Clean Revenue Cycle",
    name: "Jordan Ellis",
    detail: "Completed encounter → signed note → charge → 837P claim → ERA/payment → zero balance.",
    href: "/clients/ff648f71-9c94-433c-9aab-f80b039a80fd",
  },
  {
    title: "Inactive Eligibility",
    name: "Morgan Reed",
    detail: "Upcoming appointment is blocked because the synthetic 271 response shows inactive coverage.",
    href: "/clients/e4709001-0620-4bf0-a9b8-9947d5630423",
  },
  {
    title: "Missing Authorization",
    name: "Taylor Brooks",
    detail: "Coverage is active, but the scheduled 90837 service is blocked until authorization is obtained.",
    href: "/clients/cf537c94-9748-4725-aa11-ac7b503e83f7",
  },
  {
    title: "Credentialing Block",
    name: "Casey Martin",
    detail: "The patient is ready, but the rendering provider is not approved with UnitedHealthcare.",
    href: "/clients/e3f0fbd7-3964-4a24-b0cb-05c097f4c82f",
  },
  {
    title: "Missing Documentation",
    name: "Sofia Nguyen",
    detail: "The service is complete, but an unsigned clinical note holds the encounter out of billing.",
    href: "/clients/13e518bb-fd55-4ebe-a1e2-5a137c3a80c1",
  },
  {
    title: "Clearinghouse Rejection",
    name: "DEMO-REJECT-001",
    detail: "The 837P was rejected with an A3 response and routed to Work Center for correction and resubmission.",
    href: "/claims/61000000-0000-4000-8000-000000000002",
  },
  {
    title: "Payer Denial",
    name: "DEMO-DENIAL-001",
    detail: "The payer denied the claim with CARC 197 / RARC N130 and created denial follow-up work without auto-appeal.",
    href: "/claims/61000000-0000-4000-8000-000000000003",
  },
];

export const phase5MailroomScenarios: DemoScenario[] = [
  {
    title: "New Payer Correspondence",
    name: "Aetna",
    detail: "A newly received payer notice is waiting for classification and review in the Mailroom inbox.",
    href: "/mailroom/75000000-0000-4000-8000-000000000001",
  },
  {
    title: "Medical Records Deadline",
    name: "Jordan Ellis",
    detail: "A medical-record request is due September 18 and already has high-priority correspondence work in Work Center.",
    href: "/mailroom/75000000-0000-4000-8000-000000000002",
  },
  {
    title: "Claim Recoupment Notice",
    name: "P3-RECOUP-001",
    detail: "A reviewed recoupment notice is linked directly to the existing Phase 3 recovery claim and patient context.",
    href: "/mailroom/75000000-0000-4000-8000-000000000003",
  },
  {
    title: "Provider Credentialing Letter",
    name: "Jamie Parker, LCSW",
    detail: "A credentialing roster letter is classified to the provider and Aetna without exposing internal identifiers.",
    href: "/mailroom/75000000-0000-4000-8000-000000000004",
  },
  {
    title: "Resolved Appeal Response",
    name: "P3-APPEAL-001",
    detail: "A resolved payer appeal response shows completed correspondence work and an auditable status history.",
    href: "/mailroom/75000000-0000-4000-8000-000000000005",
  },
];
