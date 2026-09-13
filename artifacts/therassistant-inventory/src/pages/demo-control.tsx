import {
  useEffect,
  useState,
} from "react";

import {
  Link,
} from "wouter";

import {
  StatusBadge,
} from "../components/status-badge";

import {
  parseApiResponse,
  useApi,
} from "../lib/therassistant-api";


const DEFAULT_TENANT =
  "10000000-0000-4000-8000-000000000002";


type StatusData = {
  tenant:
    Record<string, any>;

  summary:
    Record<string, any>;

  managedPractices:
    Array<Record<string, any>>;

  operationalDemoTenantId:
    string;
};


const frontRangeSteps = [
  {
    number: 1,
    title:
      "Patient Experience",
    description:
      "Taylor Brooks confirms demographics and insurance, sends On My Way, arrives, checks in, and shares a journal entry.",
    href:
      "/patient-portal/40000000-0000-4000-8000-000000000003",
    button:
      "Open Patient Portal",
  },

  {
    number: 2,
    title:
      "Pre-Session Dashboard",
    description:
      "See patient check-in, eligibility, authorization utilization, diagnoses, treatment plan, and documentation context before the session.",
    href:
      "/schedule",
    button:
      "Open Schedule",
  },

  {
    number: 3,
    title:
      "Medicaid Decision Support",
    description:
      "See why a Medicaid service is ready, requires review, or is blocked using eligibility, authorization, provider, coding, and documentation data.",
    href:
      "/medicaid",
    button:
      "Open Medicaid Tools",
  },

  {
    number: 4,
    title:
      "Clinical Golden Thread",
    description:
      "Follow treatment goals through patient-reported progress and provider documentation without automatically merging the patient journal into the clinical note.",
    href:
      "/journal",
    button:
      "Open Patient Journal",
  },

  {
    number: 5,
    title:
      "Charge Readiness",
    description:
      "Validate documentation, diagnosis, payer, provider, authorization, and credentialing before a claim can be created.",
    href:
      "/charges",
    button:
      "Open Charges",
  },

  {
    number: 6,
    title:
      "837P Submission",
    description:
      "Validate TA-DEMO-837P-001, create an 837P batch, submit it, and inspect synthetic 999 and 277CA acknowledgements.",
    href:
      "/claims/submission",
    button:
      "Open Submission Center",
  },

  {
    number: 7,
    title:
      "Payment & A/R Resolution",
    description:
      "Review ERA posting, Casey Martin's contract underpayment, Morgan Reed's denial and appeal, corrected claims, reconsideration, secondary billing, and refunds.",
    href:
      "/ar-denials",
    button:
      "Open A/R & Denials",
  },

  {
    number: 8,
    title:
      "Credentialing Blocks Revenue",
    description:
      "Follow Jamie Parker's payer enrollment from not started to approved and see the credentialing-related charge block released.",
    href:
      "/credentialing",
    button:
      "Open Credentialing",
  },

  {
    number: 9,
    title:
      "Mailroom Becomes Work",
    description:
      "Route payer correspondence to the Work Center while preserving links to the client, claim, authorization, or provider.",
    href:
      "/mailroom",
    button:
      "Open Mailroom",
  },

  {
    number: 10,
    title:
      "Executive & Compliance View",
    description:
      "Finish with multi-practice reporting, payer performance, users and roles, audit history, PHI-access history, import validation, and database inventory.",
    href:
      "/reports",
    button:
      "Open Reports",
  },
];


export function DemoControlCenter() {
  const [
    tenantId,
    setTenantId,
  ] =
    useState(
      () =>
        window.localStorage
          .getItem(
            "therassistant-demo-tenant-id",
          )
        ||
        DEFAULT_TENANT,
    );


  useEffect(
    () => {
      const handler =
        (
          event: Event,
        ) => {
          const custom =
            event as CustomEvent<{
              tenantId?: string;
            }>;


          if (
            custom.detail
              ?.tenantId
          ) {
            setTenantId(
              custom.detail
                .tenantId,
            );
          }
        };


      window.addEventListener(
        "therassistant-tenant-change",
        handler,
      );


      return () => {
        window.removeEventListener(
          "therassistant-tenant-change",
          handler,
        );
      };
    },
    [],
  );


  const {
    data,
    loading,
    error,
  } =
    useApi<StatusData>(
      `/api/demo-control/status?tenantId=${encodeURIComponent(
        tenantId,
      )}`,
    );


  const [
    resetting,
    setResetting,
  ] =
    useState(false);


  const [
    resetError,
    setResetError,
  ] =
    useState<string | null>(
      null,
    );


  async function resetDemo() {
    if (
      !window.confirm(
        "Reset all synthetic Therassistant demo workflows to their original starting state?",
      )
    ) {
      return;
    }


    setResetting(true);
    setResetError(null);


    try {
      const response =
        await fetch(
          "/api/demo-control/reset",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                confirm:
                  "RESET_SYNTHETIC_DEMO",
              }),
          },
        );


      await parseApiResponse(response);


      window.localStorage
        .setItem(
          "therassistant-demo-tenant-id",
          DEFAULT_TENANT,
        );


      window.location.href =
        "/demo?reset=1";
    } catch (error) {
      setResetError(
        error instanceof Error
          ? error.message
          : "Demo reset failed.",
      );

      setResetting(false);
    }
  }


  if (loading) {
    return (
      <div className="thera-state">
        Loading Demo Control Center...
      </div>
    );
  }


  if (error || !data) {
    return (
      <div className="thera-state error">
        {error ||
          "Unable to load Demo Control Center."}
      </div>
    );
  }


  const tenant =
    data.tenant;


  const summary =
    data.summary;


  const isOperationalDemo =
    tenant.id ===
    data.operationalDemoTenantId;


  const isBillingCompany =
    tenant.tenantType ===
    "billing_company";


  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">
            GUIDED PRODUCT DEMO
          </div>

          <h1>
            Therassistant Demo Control Center
          </h1>

          <p>
            Use this page to move through the
            connected behavioral-health clinical
            and revenue-cycle story, switch
            organizational context, or restore
            all synthetic scenarios to their
            starting state.
          </p>
        </div>

        <button
          type="button"
          className="thera-button danger"
          disabled={
            resetting
          }
          onClick={() =>
            void resetDemo()
          }
        >
          {resetting
            ? "Resetting..."
            : "Reset Demo"}
        </button>
      </div>


      {resetError && (
        <div className="thera-alert danger">
          {resetError}
        </div>
      )}


      <section className="thera-demo-workspace-card">
        <div className="thera-row-between">
          <div>
            <div className="thera-field-label">
              CURRENT WORKSPACE
            </div>

            <h2>
              {tenant.name}
            </h2>
          </div>

          <StatusBadge
            value={
              tenant.status
            }
          />
        </div>

        <div className="thera-table-subtext">
          {String(
            tenant.tenantType,
          ).replaceAll(
            "_",
            " ",
          )}
          {tenant.timezone
            ? ` · ${tenant.timezone}`
            : ""}
        </div>
      </section>


      <div className="thera-metric-grid">
        <Metric
          name="Clients"
          value={
            summary.clients ?? 0
          }
        />

        <Metric
          name="Providers"
          value={
            summary.providers ??
            0
          }
        />

        <Metric
          name="Appointments"
          value={
            summary.appointments ??
            0
          }
        />

        <Metric
          name="Claims"
          value={
            summary.claims ?? 0
          }
        />

        <Metric
          name="Open Work"
          value={
            summary.openWorkItems ??
            0
          }
        />
      </div>


      {isBillingCompany && (
        <section className="thera-card thera-section-gap">
          <div className="thera-card-header">
            <div>
              <h2>
                Managed Practices
              </h2>

              <p>
                Therassistant Revenue Cycle
                Services can operate across
                multiple practice tenants while
                preserving organizational
                boundaries.
              </p>
            </div>
          </div>


          <div className="thera-stack">
            {data.managedPractices.map(
              (
                practice,
              ) => (
                <div
                  className="thera-report-list-row"
                  key={
                    practice.id
                  }
                >
                  <strong>
                    {practice.name}
                  </strong>

                  <StatusBadge
                    value={
                      practice.status
                    }
                  />
                </div>
              ),
            )}
          </div>


          <div className="thera-journal-actions">
            <Link
              href="/reports"
              className="thera-action"
            >
              Cross-Practice Reports
            </Link>

            <Link
              href="/administration"
              className="thera-action secondary"
            >
              Administration
            </Link>
          </div>
        </section>
      )}


      {!isOperationalDemo &&
        !isBillingCompany && (
        <section className="thera-card thera-section-gap">
          <div className="thera-empty">
            <strong>
              This practice tenant does not
              contain the seeded interactive
              walkthrough.
            </strong>

            <p>
              Switch the Demo Workspace to
              Front Range Behavioral Health for
              the full clinical and revenue-cycle
              scenario.
            </p>
          </div>
        </section>
      )}


      {isOperationalDemo && (
        <>
          <section className="thera-card thera-section-gap">
            <div className="thera-card-header">
              <div>
                <h2>
                  Recommended Demo Story
                </h2>

                <p>
                  The sequence below shows how
                  Therassistant connects patient
                  engagement, clinical work,
                  billing readiness, payer
                  operations, and financial
                  resolution.
                </p>
              </div>
            </div>


            <div className="thera-demo-step-grid">
              {frontRangeSteps.map(
                (step) => (
                  <article
                    className="thera-demo-step-card"
                    key={
                      step.number
                    }
                  >
                    <div className="thera-demo-step-number">
                      {step.number}
                    </div>

                    <div>
                      <h3>
                        {step.title}
                      </h3>

                      <p>
                        {step.description}
                      </p>

                      <Link
                        href={
                          step.href
                        }
                        className="thera-action secondary"
                      >
                        {step.button}
                      </Link>
                    </div>
                  </article>
                ),
              )}
            </div>
          </section>


          <section className="thera-card thera-section-gap">
            <div className="thera-card-header">
              <div>
                <h2>
                  Demo Characters
                </h2>

                <p>
                  Each synthetic client or
                  provider demonstrates a
                  different revenue-cycle
                  scenario.
                </p>
              </div>
            </div>


            <div className="thera-demo-character-grid">
              <Character
                name="Jordan Ellis"
                story="Clean claim and payment; also demonstrates overpayment/refund review."
              />

              <Character
                name="Morgan Reed"
                story="Denial, appeal, reconsideration, and secondary billing."
              />

              <Character
                name="Taylor Brooks"
                story="Patient portal, Medicaid eligibility, low authorization units, and clinical documentation workflow."
              />

              <Character
                name="Casey Martin"
                story="Contract-based underpayment review."
              />

              <Character
                name="Jamie Parker, LCSW"
                story="Credentialing and payer enrollment blocking billing readiness."
              />
            </div>
          </section>
        </>
      )}


      <section className="thera-card thera-demo-instruction">
        <div className="thera-eyebrow">
          DEMO SAFETY
        </div>

        <h2>
          Synthetic Data Only
        </h2>

        <p>
          The reset button deletes and rebuilds
          the synthetic operational demonstration
          dataset. Database Inventory data is
          preserved. Medicaid rules, timely-filing
          limits, clearinghouse responses, payer
          correspondence, and clinical scenarios
          in this demo are illustrative rather
          than current payer policy or real PHI.
        </p>
      </section>
    </>
  );
}


function Metric({
  name,
  value,
}: {
  name: string;
  value:
    | string
    | number;
}) {
  return (
    <div className="thera-metric-card">
      <div className="thera-metric-label">
        {name}
      </div>

      <div className="thera-metric-value">
        {value}
      </div>
    </div>
  );
}


function Character({
  name,
  story,
}: {
  name: string;
  story: string;
}) {
  return (
    <div className="thera-demo-character">
      <strong>
        {name}
      </strong>

      <p>
        {story}
      </p>
    </div>
  );
}
