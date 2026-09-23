export type E2ERole = "staff" | "provider" | "patient";

type Identity = { email: string; password: string };

const ENV_BY_ROLE: Record<E2ERole, { email: string; password: string }> = {
  staff: { email: "E2E_STAFF_EMAIL", password: "E2E_STAFF_PASSWORD" },
  provider: { email: "E2E_PROVIDER_EMAIL", password: "E2E_PROVIDER_PASSWORD" },
  patient: { email: "E2E_PATIENT_EMAIL", password: "E2E_PATIENT_PASSWORD" },
};

function requireSyntheticEmail(role: E2ERole, email: string) {
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split("@")[1] ?? "";
  if (!domain.endsWith(".test") && !domain.endsWith(".invalid")) {
    throw new Error(
      `${role} E2E identity must use a reserved synthetic domain (.test or .invalid), not ${email}.`,
    );
  }
  return normalized;
}

export function requireSyntheticIdentityMatrix(): Record<E2ERole, Identity> {
  const identities = Object.fromEntries(
    (Object.keys(ENV_BY_ROLE) as E2ERole[]).map((role) => {
      const names = ENV_BY_ROLE[role];
      const rawEmail = process.env[names.email]?.trim();
      const password = process.env[names.password];
      if (!rawEmail || !password) {
        throw new Error(
          `Missing ${names.email} or ${names.password}. Staff, provider, and patient E2E identities must all be configured.`,
        );
      }
      return [role, { email: requireSyntheticEmail(role, rawEmail), password }];
    }),
  ) as Record<E2ERole, Identity>;

  const emails = Object.values(identities).map((identity) => identity.email);
  if (new Set(emails).size !== emails.length) {
    throw new Error("Staff, provider, and patient E2E identities must use three distinct email addresses.");
  }
  return identities;
}
