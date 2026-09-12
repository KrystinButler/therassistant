import { Route, Switch } from "wouter";

import InventoryApp from "./InventoryApp";

import { AppShell } from "./components/app-shell";

import { DashboardPage } from "./pages/dashboard";
import { ClientsPage } from "./pages/clients";
import { ClientDetailPage } from "./pages/client-detail";
import { ClaimsPage } from "./pages/claims";
import { ClaimDetailPage } from "./pages/claim-detail";
import { WorkCenterPage } from "./pages/work-center";
import { ProvidersPage } from "./pages/providers";
import { ProviderDetailPage } from "./pages/provider-detail";
import { AdministrationPage } from "./pages/administration";
import { ModulePlaceholder } from "./pages/module-placeholder";

export default function App() {
  return (
    <AppShell>
      <Switch>
        <Route path="/">
          <DashboardPage />
        </Route>

        <Route path="/work-center">
          <WorkCenterPage />
        </Route>

        <Route path="/clients/:id">
          <ClientDetailPage />
        </Route>

        <Route path="/clients">
          <ClientsPage />
        </Route>

        <Route path="/claims/:id">
          <ClaimDetailPage />
        </Route>

        <Route path="/claims">
          <ClaimsPage />
        </Route>

        <Route path="/providers/:id">
          <ProviderDetailPage />
        </Route>

        <Route path="/providers">
          <ProvidersPage />
        </Route>

        <Route path="/schedule">
          <ModulePlaceholder
            eyebrow="CLINICAL OPERATIONS"
            title="Schedule"
            description="Appointments become the starting point for clinical readiness, eligibility, authorization, documentation, and charge capture."
            capabilities={[
              "Provider schedule",
              "Client check-in",
              "Appointment readiness",
              "Eligibility alerts",
              "Authorization alerts",
              "Pre-session review",
            ]}
          />
        </Route>

        <Route path="/clinical">
          <ModulePlaceholder
            eyebrow="CONNECTED CLINICAL WORKFLOW"
            title="Clinical"
            description="Therassistant connects treatment planning and provider documentation directly to billing readiness."
            capabilities={[
              "Pre-Session Dashboard",
              "Treatment plans and goals",
              "Clinical notes",
              "Golden-thread review",
              "Patient journal",
              "Signature readiness",
            ]}
          />
        </Route>

        <Route path="/eligibility">
          <ModulePlaceholder
            eyebrow="PAYER READINESS"
            title="Eligibility"
            description="Eligibility is treated as operational data that affects scheduling, authorization, billing, and collections."
            capabilities={[
              "Coverage status",
              "Network status",
              "Copay and coinsurance",
              "Deductible tracking",
              "Authorization requirements",
              "Medicaid program routing",
            ]}
          />
        </Route>

        <Route path="/charges">
          <ModulePlaceholder
            eyebrow="BILLING READINESS"
            title="Charge Capture"
            description="Charges move forward only when clinical and payer requirements are ready for billing."
            capabilities={[
              "Captured charges",
              "Documentation checks",
              "Provider enrollment checks",
              "Authorization checks",
              "Coding review",
              "Ready-for-claim workflow",
            ]}
          />
        </Route>

        <Route path="/payments">
          <ModulePlaceholder
            eyebrow="REMITTANCE OPERATIONS"
            title="Payments"
            description="Payments, allocations, ERA detail, adjustments, and exceptions remain connected to the underlying claim."
            capabilities={[
              "ERA posting",
              "Payment allocation",
              "Claim-line allocation",
              "Zero-pay review",
              "Secondary balances",
              "Payment exceptions",
            ]}
          />
        </Route>

        <Route path="/ar-denials">
          <ModulePlaceholder
            eyebrow="REVENUE RECOVERY"
            title="A/R & Denials"
            description="A/R follow-up, denials, appeals, underpayments, overpayments, and refund decisions share one operational workflow."
            capabilities={[
              "Denial intelligence",
              "CARC/RARC workflow",
              "Appeals",
              "Underpayment detection",
              "Overpayment review",
              "A/R prioritization",
            ]}
          />
        </Route>

        <Route path="/credentialing">
          <ModulePlaceholder
            eyebrow="PAYER OPERATIONS"
            title="Credentialing"
            description="Provider participation and payer enrollment are connected directly to claim readiness."
            capabilities={[
              "Provider payer enrollment",
              "Group affiliation",
              "Provider identifiers",
              "Application status",
              "Required actions",
              "Billing impact alerts",
            ]}
          />
        </Route>

        <Route path="/payers-contracts">
          <ModulePlaceholder
            eyebrow="CONTRACT INTELLIGENCE"
            title="Payers & Contracts"
            description="Plans, contracts, fee schedules, and provider enrollment data support payment and underpayment review."
            capabilities={[
              "Payers and aliases",
              "Products and plans",
              "Contracts",
              "Fee schedules",
              "Expected reimbursement",
              "Participation relationships",
            ]}
          />
        </Route>

        <Route path="/mailroom">
          <ModulePlaceholder
            eyebrow="CORRESPONDENCE OPERATIONS"
            title="Mailroom"
            description="Incoming payer correspondence becomes trackable operational work instead of an isolated document."
            capabilities={[
              "Incoming documents",
              "Denial letters",
              "Recoupments",
              "Medical-record requests",
              "Authorization letters",
              "Work Center routing",
            ]}
          />
        </Route>

        <Route path="/reports">
          <ModulePlaceholder
            eyebrow="OPERATIONAL INTELLIGENCE"
            title="Reports"
            description="Reporting spans clinical readiness, claims, payments, denials, credentialing, authorization, and multi-practice operations."
            capabilities={[
              "A/R aging",
              "Claim status",
              "Denial trends",
              "Payment performance",
              "Authorization utilization",
              "Credentialing status",
            ]}
          />
        </Route>

        <Route path="/administration/database-inventory">
          <InventoryApp />
        </Route>

        <Route path="/administration">
          <AdministrationPage />
        </Route>

        <Route>
          <div className="thera-state">
            Page not found.
          </div>
        </Route>
      </Switch>
    </AppShell>
  );
}
