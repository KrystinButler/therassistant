import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";

import InventoryApp from "./InventoryApp";
import { AppShell } from "./components/app-shell";
import { DenialsPage } from "./domains/ar/DenialsPage";
import { BillingHubPage } from "./domains/billing/BillingHubPage";
import { BillingQueuePage } from "./domains/billing/BillingQueuePage";
import { Claim360Page } from "./domains/claims/Claim360Page";
import { ClaimsPage } from "./domains/claims/ClaimsPage";
import { RejectionsPage } from "./domains/claims/RejectionsPage";
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
import {
  SettingsOverviewPage,
  SettingsPlaceholderPage,
} from "./domains/settings/SettingsOverviewPage";
import { ClientsPage } from "./pages/clients";
import { DashboardPage } from "./pages/dashboard";
import { DemoControlCenter } from "./pages/demo-control";
import { PayerDetailPage } from "./pages/payer-detail";
import { ProviderDetailPage } from "./pages/provider-detail";
import { ProvidersPage } from "./pages/providers";
import { ReportsPage } from "./pages/operational-workspaces";
import {
  ClinicalPage,
  GoldenThreadPage,
  ImportsPage,
  JournalPage,
  MedicaidPage,
} from "./pages/restored-modules";

function Redirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => navigate(to, { replace: true }), [navigate, to]);
  return <div className="thera-state">Redirecting...</div>;
}

export default function App() {
  return (
    <AppShell>
      <Switch>
        <Route path="/demo"><DemoControlCenter /></Route>
        <Route path="/patient-portal/:clientId"><PatientPortalPage /></Route>
        <Route path="/clinical/golden-thread/:clientId"><GoldenThreadPage /></Route>
        <Route path="/claims/submission"><Redirect to="/billing/charges" /></Route>
        <Route path="/claims/follow-up"><Redirect to="/claims" /></Route>
        <Route path="/ar-denials"><Redirect to="/denials" /></Route>
        <Route path="/work-center"><Redirect to="/claims" /></Route>
        <Route path="/charges"><Redirect to="/billing/charges" /></Route>
        <Route path="/schedule/:id"><PreSessionPage /></Route>
        <Route path="/encounters/:id"><EncounterPage /></Route>
        <Route path="/clients/:id"><PatientChartPage /></Route>
        <Route path="/claims/:id"><Claim360Page /></Route>
        <Route path="/providers/:id"><ProviderDetailPage /></Route>
        <Route path="/payers/:id"><PayerDetailPage /></Route>
        <Route path="/mailroom/:id"><CorrespondencePage /></Route>
        <Route path="/billing/charges"><BillingQueuePage /></Route>
        <Route path="/rejections"><RejectionsPage /></Route>
        <Route path="/denials"><DenialsPage /></Route>
        <Route path="/clients"><ClientsPage /></Route>
        <Route path="/providers"><ProvidersPage /></Route>
        <Route path="/schedule"><SchedulePage /></Route>
        <Route path="/clinical"><ClinicalPage /></Route>
        <Route path="/journal"><JournalPage /></Route>
        <Route path="/eligibility"><EligibilityPage /></Route>
        <Route path="/authorizations"><AuthorizationsPage /></Route>
        <Route path="/medicaid"><MedicaidPage /></Route>
        <Route path="/billing"><BillingHubPage /></Route>
        <Route path="/claims"><ClaimsPage /></Route>
        <Route path="/payments"><PaymentsPage /></Route>
        <Route path="/credentialing"><CredentialingPage /></Route>
        <Route path="/payers-contracts"><PayersContractsPage /></Route>
        <Route path="/mailroom"><MailroomPage /></Route>
        <Route path="/reports"><ReportsPage /></Route>

        <Route path="/settings/practice">
          <SettingsPlaceholderPage title="Practice Information & Locations" description="Change your practice name, contact information, timezone, and locations." />
        </Route>
        <Route path="/settings/logo">
          <SettingsPlaceholderPage title="Practice Logo" description="Upload the logo used on printed documents and the Client Portal." />
        </Route>
        <Route path="/settings/patient-records">
          <SettingsPlaceholderPage title="Patient Records" description="Enable or disable optional features for patient records." />
        </Route>
        <Route path="/settings/client-portal">
          <SettingsPlaceholderPage title="Client Portal" description="Configure Client Portal access, balance limits, and optional features." />
        </Route>
        <Route path="/settings/service-codes">
          <SettingsPlaceholderPage title="Service Codes" description="Customize the CPT, HCPCS, and service codes used by the practice." />
        </Route>
        <Route path="/settings/diagnosis-codes">
          <SettingsPlaceholderPage title="Diagnosis Codes" description="Control which diagnosis codes appear in Therassistant searches." />
        </Route>
        <Route path="/settings/interventions">
          <SettingsPlaceholderPage title="Interventions" description="Customize interventions used in Treatment Plans and Progress Notes." />
        </Route>
        <Route path="/settings/practice-billing">
          <SettingsPlaceholderPage title="Practice Billing" description="Configure practice-wide billing defaults and claim behavior." />
        </Route>
        <Route path="/settings/patient-billing">
          <SettingsPlaceholderPage title="Patient Billing" description="Configure patient billing, statements, thresholds, and payment-plan options." />
        </Route>
        <Route path="/settings/payment-processing">
          <SettingsPlaceholderPage title="Payment Processing" description="Configure secure payment processing for credit, debit, FSA, and HSA cards." />
        </Route>
        <Route path="/settings/staff">
          <SettingsPlaceholderPage title="Staff" description="Add staff and manage account status, roles, and access." />
        </Route>
        <Route path="/settings/activity-log">
          <SettingsPlaceholderPage title="Activity Log" description="Search user activity and protected-health-information access history." />
        </Route>
        <Route path="/settings/password">
          <SettingsPlaceholderPage title="Change Your Password" description="Update your password securely." />
        </Route>
        <Route path="/settings"><SettingsOverviewPage /></Route>

        <Route path="/administration/imports"><ImportsPage /></Route>
        <Route path="/administration/database-inventory"><InventoryApp /></Route>
        <Route path="/administration"><Redirect to="/settings" /></Route>
        <Route path="/"><DashboardPage /></Route>
        <Route><div className="thera-state">Page not found.</div></Route>
      </Switch>
    </AppShell>
  );
}
