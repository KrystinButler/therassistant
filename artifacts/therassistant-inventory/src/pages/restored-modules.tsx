import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  Link,
  useRoute,
} from "wouter";

type Row =
  Record<string, unknown>;

function useJson(
  endpoint: string,
) {
  const [data, setData] =
    useState<unknown>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError(null);

    fetch(endpoint)
      .then(async (response) => {
        const body =
          await response.json();

        if (!response.ok) {
          throw new Error(
            body?.error ??
            `HTTP ${response.status}`,
          );
        }

        return body;
      })
      .then((body) => {
        if (active) {
          setData(body);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Request failed.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [endpoint]);

  return {
    data,
    loading,
    error,
  };
}

function humanize(
  value: string,
) {
  return value
    .replace(
      /([a-z0-9])([A-Z])/g,
      "$1 $2",
    )
    .replaceAll("_", " ")
    .replace(
      /\b\w/g,
      (letter) =>
        letter.toUpperCase(),
    );
}

function display(
  value: unknown,
): ReactNode {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "—";
  }

  if (
    typeof value === "boolean"
  ) {
    return value
      ? "Yes"
      : "No";
  }

  if (
    typeof value === "object"
  ) {
    return JSON.stringify(value);
  }

  const text =
    String(value);

  if (
    /^\d{4}-\d{2}-\d{2}T/.test(
      text,
    )
  ) {
    const date =
      new Date(text);

    if (
      !Number.isNaN(
        date.getTime(),
      )
    ) {
      return date
        .toLocaleString();
    }
  }

  return text;
}

function Table({
  rows,
}: {
  rows: Row[];
}) {
  const columns =
    useMemo(() => {
      const first =
        rows[0];

      if (!first) {
        return [];
      }

      return Object
        .keys(first)
        .filter(
          (key) =>
            ![
              "metadata",
              "raw_response",
              "rawResponse",
            ].includes(key),
        )
        .slice(0, 8);
    }, [rows]);

  if (!rows.length) {
    return (
      <div className="thera-state">
        No records.
      </div>
    );
  }

  return (
    <div className="thera-table-wrap">
      <table className="thera-table">
        <thead>
          <tr>
            {columns.map(
              (column) => (
                <th key={column}>
                  {humanize(column)}
                </th>
              ),
            )}
          </tr>
        </thead>

        <tbody>
          {rows.map(
            (row, index) => (
              <tr
                key={
                  String(
                    row.id ??
                    index,
                  )
                }
              >
                {columns.map(
                  (column) => (
                    <td key={column}>
                      {display(
                        row[column],
                      )}
                    </td>
                  ),
                )}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  title,
  rows,
}: {
  title: string;
  rows: Row[];
}) {
  return (
    <section className="thera-card">
      <div className="thera-card-header">
        <h2>{title}</h2>
      </div>

      <Table rows={rows} />
    </section>
  );
}

function PrimitiveCards({
  data,
}: {
  data: Row;
}) {
  const entries =
    Object.entries(data)
      .filter(
        ([, value]) =>
          value === null ||
          [
            "string",
            "number",
            "boolean",
          ].includes(
            typeof value,
          ),
      );

  if (!entries.length) {
    return null;
  }

  return (
    <div className="thera-metric-grid">
      {entries.map(
        ([key, value]) => (
          <div
            className="thera-metric-card"
            key={key}
          >
            <div className="thera-metric-label">
              {humanize(key)}
            </div>

            <div className="thera-metric-value small">
              {display(value)}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function ObjectSections({
  data,
}: {
  data: Row;
}) {
  const arrays =
    Object.entries(data)
      .filter(
        ([, value]) =>
          Array.isArray(value),
      );

  return (
    <>
      <PrimitiveCards data={data} />

      <div className="thera-stack">
        {arrays.map(
          ([key, value]) => (
            <Section
              key={key}
              title={humanize(key)}
              rows={
                value as Row[]
              }
            />
          ),
        )}
      </div>
    </>
  );
}

function ModulePage({
  endpoint,
  eyebrow,
  title,
  description,
  links = [],
  warning,
}: {
  endpoint: string;
  eyebrow: string;
  title: string;
  description: string;
  links?: Array<{
    href: string;
    label: string;
  }>;
  warning?: string;
}) {
  const {
    data,
    loading,
    error,
  } =
    useJson(endpoint);

  if (loading) {
    return (
      <div className="thera-state">
        Loading {title}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="thera-state error">
        {error}
      </div>
    );
  }

  return (
    <>
      <div className="thera-page-header">
        <div className="thera-eyebrow">
          {eyebrow}
        </div>

        <h1>{title}</h1>

        <p>{description}</p>

        {links.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 12,
            }}
          >
            {links.map(
              (link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="thera-action"
                >
                  {link.label}
                </Link>
              ),
            )}
          </div>
        )}
      </div>

      {warning && (
        <div className="thera-alert">
          {warning}
        </div>
      )}

      {Array.isArray(data) ? (
        <Section
          title={title}
          rows={
            data as Row[]
          }
        />
      ) : (
        <ObjectSections
          data={
            (data ?? {}) as Row
          }
        />
      )}
    </>
  );
}

export function SchedulePage() {
  return (
    <ModulePage
      endpoint="/api/schedule"
      eyebrow="CLINICAL OPERATIONS"
      title="Schedule"
      description="Appointments connected to readiness, eligibility, authorization, documentation, and charge capture."
    />
  );
}

export function ClinicalPage() {
  return (
    <ModulePage
      endpoint="/api/clinical"
      eyebrow="CONNECTED CLINICAL WORKFLOW"
      title="Clinical"
      description="Treatment planning and documentation connected directly to billing readiness."
      links={[
        {
          href: "/journal",
          label: "Patient Journal",
        },
      ]}
    />
  );
}

export function EligibilityPage() {
  return (
    <ModulePage
      endpoint="/api/eligibility"
      eyebrow="PAYER READINESS"
      title="Eligibility"
      description="Coverage and benefit information used operationally before services are billed."
      links={[
        {
          href: "/authorizations",
          label: "Authorizations",
        },
        {
          href: "/medicaid",
          label: "Medicaid Helper",
        },
      ]}
    />
  );
}

export function AuthorizationsPage() {
  return (
    <ModulePage
      endpoint="/api/authorizations"
      eyebrow="UTILIZATION MANAGEMENT"
      title="Authorizations"
      description="Authorization status and utilization remain connected to scheduling and billing readiness."
    />
  );
}

export function MedicaidPage() {
  return (
    <ModulePage
      endpoint="/api/medicaid"
      eyebrow="MEDICAID DECISION SUPPORT"
      title="Medicaid Coding Helper"
      description="Program, authorization, and coding information for the synthetic Therassistant demonstration."
      warning="Demo rules are synthetic and are not current payer policy."
    />
  );
}

export function ChargesPage() {
  return (
    <ModulePage
      endpoint="/api/charges"
      eyebrow="BILLING READINESS"
      title="Charge Capture"
      description="Charges move forward only when clinical and payer requirements are ready."
    />
  );
}

export function PaymentsPage() {
  return (
    <ModulePage
      endpoint="/api/payments-overview"
      eyebrow="REMITTANCE OPERATIONS"
      title="Payments"
      description="Payments, ERA files, adjustments, and posting information in one operational view."
    />
  );
}

export function ArDenialsPage() {
  return (
    <ModulePage
      endpoint="/api/ar-denials"
      eyebrow="REVENUE RECOVERY"
      title="A/R & Denials"
      description="Open balances, denials, appeals, and overpayment review."
      links={[
        {
          href: "/claims/follow-up",
          label: "Advanced Claim Follow-Up",
        },
      ]}
    />
  );
}

export function CredentialingPage() {
  return (
    <ModulePage
      endpoint="/api/credentialing"
      eyebrow="PAYER OPERATIONS"
      title="Credentialing"
      description="Provider participation, enrollment, identifiers, and payer relationships."
    />
  );
}

export function PayersContractsPage() {
  return (
    <ModulePage
      endpoint="/api/payers-contracts"
      eyebrow="CONTRACT INTELLIGENCE"
      title="Payers & Contracts"
      description="Payers, contracts, fee schedules, and reimbursement data."
    />
  );
}

export function MailroomPage() {
  return (
    <ModulePage
      endpoint="/api/mailroom"
      eyebrow="CORRESPONDENCE OPERATIONS"
      title="Mailroom"
      description="Payer correspondence organized as operational work."
    />
  );
}

export function ImportsPage() {
  return (
    <ModulePage
      endpoint="/api/imports"
      eyebrow="DATA QUALITY"
      title="Import Validation"
      description="Imported records and validation errors before data enters production workflows."
    />
  );
}

export function JournalPage() {
  return (
    <ModulePage
      endpoint="/api/journal"
      eyebrow="PATIENT-REPORTED CONTEXT"
      title="Patient Journal"
      description="Patient-authored information remains separate from provider documentation until reviewed."
    />
  );
}

export function ClaimSubmissionPage() {
  return (
    <ModulePage
      endpoint="/api/claim-submission"
      eyebrow="837P SUBMISSION"
      title="Claim Submission"
      description="Claims, batches, submissions, and clearinghouse responses."
    />
  );
}

export function ClaimFollowUpPage() {
  return (
    <ModulePage
      endpoint="/api/claim-follow-up"
      eyebrow="ADVANCED CLAIM WORKFLOW"
      title="Claim Follow-Up"
      description="Follow-up actions, timely-filing rules, overpayment reviews, and refunds."
      warning="Timely-filing values in this demonstration are synthetic."
    />
  );
}

export function ReportsPage() {
  return (
    <ModulePage
      endpoint="/api/reports"
      eyebrow="OPERATIONAL INTELLIGENCE"
      title="Reports"
      description="Connected clinical, revenue-cycle, payer, and workqueue metrics."
    />
  );
}

export function PreSessionPage() {
  const [, params] =
    useRoute<{
      id: string;
    }>(
      "/schedule/:id",
    );

  return (
    <ModulePage
      endpoint={
        `/api/schedule/${params?.id ?? ""}/pre-session`
      }
      eyebrow="PRE-SESSION DASHBOARD"
      title="Pre-Session Dashboard"
      description="Everything the provider and front office need before the encounter begins."
    />
  );
}

export function GoldenThreadPage() {
  const [, params] =
    useRoute<{
      clientId: string;
    }>(
      "/clinical/golden-thread/:clientId",
    );

  return (
    <ModulePage
      endpoint={
        `/api/clients/${params?.clientId ?? ""}`
      }
      eyebrow="CLINICAL CONTINUITY"
      title="Golden Thread"
      description="Client, treatment, clinical, and billing context displayed together."
    />
  );
}

export function PatientPortalPage() {
  const [, params] =
    useRoute<{
      clientId: string;
    }>(
      "/patient-portal/:clientId",
    );

  return (
    <ModulePage
      endpoint={
        `/api/clients/${params?.clientId ?? ""}`
      }
      eyebrow="PATIENT EXPERIENCE"
      title="Patient Portal Preview"
      description="Synthetic client-facing preview using the same connected client record."
    />
  );
}
