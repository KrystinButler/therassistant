import { useEffect } from "react";
import { Route, Switch, useLocation, useRoute } from "wouter";

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
import { PatientCheckInPage } from "./domains/portal/PatientCheckInPage";
import { PatientJournalPage } from "./domains/portal/PatientJournalPage";
import { PatientPortalPage } from "./domains/portal/PatientPortalPage";
import { SchedulePage } from "./domains/scheduling/SchedulePage";
import { SettingsOverviewPage } from "./domains/settings/SettingsOverviewPage";
import { SettingsRoutePage } from "./domains/settings/SettingsRoutes";
import { ClientsPage } from "./pages/clients";
import { DashboardPage } from "./pages/dashboard";
import { DemoControlCenter } from "./pages/demo-control";
import { PayerDetailPage } from "./pages/payer-detail";
import { ProviderDetailPage } from "./pages/provider-detail";
import { ProvidersPage } from "./pages/providers";
import { ReportsPage } from "./pages/operational-workspaces";
import { ClinicalPage, GoldenThreadPage, ImportsPage, JournalPage, MedicaidPage } from "./pages/restored-modules";

function Redirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => navigate(to, { replace: true }), [navigate, to]);
  return <div className="thera-state">Redirecting...</div>;
}

function ScheduleAppointmentRedirect() {
  const [, params] = useRoute<{ id: string }>("/schedule/:id");
  return <Redirect to={`/schedule?appointment=${encodeURIComponent(params?.id ?? "")}`} />;
}

export default function App() {
  const [location] = useLocation();

  if (location.startsWith("/patient-portal/")) {
    return (
      <Switch>
        <Route path="/patient-portal/:clientId/check-in/:appointmentId"><PatientCheckInPage /></Route>
        <Route path="/patient-portal/:clientId/journal"><PatientJournalPage /></Route>
        <Route path="/patient-portal/:clientId"><PatientPortalPage /></Route>
        <Route><div className="thera-state">Patient portal page not found.</div></Route>
      </Switch>
    );
  }

  return (
    <AppShell>
      <Switch>
        <Route path="/demo"><DemoControlCenter /></Route>
        <Route path="/clinical/golden-thread/:clientId"><GoldenThreadPage /></Route>
        <Route path="/claims/submission"><Redirect to="/billing/charges" /></Route>
        <Route path="/claims/follow-up"><Redirect to="/claims" /></Route>
        <Route path="/ar-denials"><Redirect to="/denials" /></Route>
        <Route path="/work-center"><Redirect to="/claims" /></Route>
        <Route path="/charges"><Redirect to="/billing/charges" /></Route>
        <Route path="/schedule/:id"><ScheduleAppointmentRedirect /></Route>
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
        <Route path="/settings/practice"><SettingsRoutePage id="practice" /></Route>
        <Route path="/settings/logo"><SettingsRoutePage id="logo" /></Route>
        <Route path="/settings/patient-records"><SettingsRoutePage id="patient-records" /></Route>
        <Route path="/settings/client-portal"><SettingsRoutePage id="client-portal" /></Route>
        <Route path="/settings/service-codes"><SettingsRoutePage id="service-codes" /></Route>
        <Route path="/settings/diagnosis-codes"><SettingsRoutePage id="diagnosis-codes" /></Route>
        <Route path="/settings/interventions"><SettingsRoutePage id="interventions" /></Route>
        <Route path="/settings/practice-billing"><SettingsRoutePage id="practice-billing" /></Route>
        <Route path="/settings/patient-billing"><SettingsRoutePage id="patient-billing" /></Route>
        <Route path="/settings/payment-processing"><SettingsRoutePage id="payment-processing" /></Route>
        <Route path="/settings/staff"><SettingsRoutePage id="staff" /></Route>
        <Route path="/settings/activity-log"><SettingsRoutePage id="activity-log" /></Route>
        <Route path="/settings/password"><SettingsRoutePage id="password" /></Route>
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
