export type BillingCorrectionLink = { href: string; label: string };
type Issue = Record<string, unknown>;
function sourceText(issue: Issue): string {
  return [issue.check_code, issue.code, issue.message].map((value) => String(value ?? "")).join(" ").toLowerCase();
}
export function billingCorrectionLink(issue: Issue, encounterId: string, clientId?: string): BillingCorrectionLink | null {
  const value = sourceText(issue);
  const encounter = "/encounters/" + encodeURIComponent(encounterId);
  if (value.includes("note_unsigned") || (value.includes("note") && (value.includes("sign") || value.includes("signature"))))
    return { href: encounter + "#encounter-signature", label: "Open note signature" };
  if (value.includes("note") || value.includes("documentation"))
    return { href: encounter + "#encounter-progress-note-editor", label: "Review clinical note" };
  if (value.includes("diagnos") || value.includes("icd-10") || value.includes("icd10"))
    return { href: encounter + "#encounter-diagnoses", label: "Open diagnosis field" };
  if (value.includes("psychotherapy_minute") || value.includes("session time") || value.includes("documented time"))
    return { href: encounter + "#encounter-session-time", label: "Review session time" };
  if (value.includes("service") || value.includes("procedure") || value.includes("cpt") || value.includes("hcpcs") ||
      value.includes("modifier") || value.includes("units") || value.includes("charge amount") || value.includes("pos code"))
    return { href: encounter + "#encounter-coding-service", label: "Open coding and service fields" };
  if (value.includes("funding") || value.includes("billing path") || value.includes("responsible party"))
    return { href: encounter + "#encounter-billing-source", label: "Open billing responsibility" };
  if ((value.includes("eligib") || value.includes("coverage") || value.includes("subscriber") || value.includes("member id")) && clientId)
    return { href: "/clients/" + encodeURIComponent(clientId) + "?tab=coverage", label: "Open patient coverage" };
  if (value.includes("provider_enrollment") || value.includes("provider enrollment") || value.includes("participation"))
    return { href: "/payers-contracts", label: "Review provider payer enrollment" };
  return null;
}
export function billingCorrectionLinks(issues: Issue[], encounterId: string, clientId?: string): BillingCorrectionLink[] {
  const links = issues.map((issue) => billingCorrectionLink(issue, encounterId, clientId)).filter((link): link is BillingCorrectionLink => link !== null);
  return [...new Map(links.map((link) => [link.href, link])).values()];
}
