import { Route, Switch } from "wouter";

import InventoryApp from "./InventoryApp";
import { AppShell } from "./components/app-shell";
import { ArWorkspacePage } from "./domains/ar/ArWorkspacePage";
import { BillingHubPage } from "./domains/billing/BillingHubPage";
import { BillingQueuePage } from "./domains/billing/BillingQueuePage";
import { Claim360Page } from "./domains/claims/Claim360Page";
import { ClaimsWorkspacePage } from "./domains/claims/ClaimsWorkspacePage";
import { ClaimSubmissionPage } from "./domains/claims/ClaimSubmissionPage";
import { CredentialingPage } from "./domains/credentialing/CredentialingPage";
import { PayersContractsPage } from "./domains/credentialing/PayersContractsPage";
import { EncounterPage } from "./domains/encounters/EncounterPage";
import { CorrespondencePage } from "./domains/mailroom/CorrespondencePage";
import { MailroomPage } from "./domains/mailroom/MailroomPage";
import { PaymentsPage } from "./domains/payments/PaymentsPage";
import { AuthorizationsPage } from "./domains/payer-readiness/AuthorizationsPage";
import { EligibilityPage } from "./domains/payer-readiness/EligibilityPage";
import { PatientChartPage } from "./domains/patients/PatientChartPage";
import { PatientPortalPage } from "./domains/portal/PatientPortalPage";
import { SchedulePage } from "./domains/scheduling/SchedulePage";
import { PreSessionPage } from "./domains/scheduling/PreSessionPage";
import { AdministrationPage } from "./pages/administration";
import { ClientsPage } from "./pages/clients";
import { DashboardPage } from "./pages/dashboard";
import { DemoControlCenter } from "./pages/demo-control";
import { PayerDetailPage } from "./pages/payer-detail";
import { ProviderDetailPage } from "./pages/provider-detail";
import { ProvidersPage } from "./pages/providers";
import { WorkCenterPage } from "./pages/work-center";
import { ReportsPage } from "./pages/operational-workspaces";
import {
  ClaimFollowUpPage,
  ClinicalPage,
  GoldenThreadPage,
  ImportsPage,
  JournalPage,
  MedicaidPage,
} from "./pages/restored-modules";

export default function App() {
  return (
    <AppShell>
      <Switch>
        <Route path="/demo"><DemoControlCenter /></Route>
        <Route path="/patient-portal/:clientId"><PatientPortalPage /></Route>
        <Route path="/clinical/golden-thread/:clientId"><GoldenThreadPage /></Route>
        <Route path="/claims/submission"><ClaimSubmissionPage /></Route>
        <Route path="/claims/follow-up"><ClaimFollowUpPage /></Route>
        <Route path="/schedule/:id"><PreSessionPage /></Route>
        <Route path="/encounters/:id"><EncounterPage /></Route>
        <Route path="/clients/:id"><PatientChartPage /></Route>
        <Route path="/claims/:id"><Claim360Page /></Route>
        <Route path="/providers/:id"><ProviderDetailPage /></Route>
        <Route path="/payers/:id"><PayerDetailPage /></Route>
        <Route path="/mailroom/:id"><CorrespondencePage /></Route>
        <Route path="/billing/charges"><BillingQueuePage /></Route>
        <Route path="/work-center"><WorkCenterPage /></Route>
        <Route path="/clients"><ClientsPage /></Route>
        <Route path="/providers"><ProvidersPage /></Route>
        <Route path="/schedule"><SchedulePage /></Route>
        <Route path="/clinical"><ClinicalPage /></Route>
        <Route path="/journal"><JournalPage /></Route>
        <Route path="/eligibility"><EligibilityPage /></Route>
        <Route path="/authorizations"><AuthorizationsPage /></Route>
        <Route path="/medicaid"><MedicaidPage /></Route>
        <Route path="/billing"><BillingHubPage /></Route>
        <Route path="/charges"><BillingQueuePage /></Route>
        <Route path="/claims"><ClaimsWorkspacePage /></Route>
        <Route path="/payments"><PaymentsPage /></Route>
        <Route path="/ar-denials"><ArWorkspacePage /></Route>
        <Route path="/credentialing"><CredentialingPage /></Route>
        <Route path="/payers-contracts"><PayersContractsPage /></Route>
        <Route path="/mailroom"><MailroomPage /></Route>
        <Route path="/reports"><ReportsPage /></Route>
        <Route path="/administration/imports"><ImportsPage /></Route>
        <Route path="/administration/database-inventory"><InventoryApp /></Route>
        <Route path="/administration"><AdministrationPage /></Route>
        <Route path="/"><DashboardPage /></Route>
        <Route><div className="thera-state">Page not found.</div></Route>
      </Switch>
    </AppShell>
  );
}
