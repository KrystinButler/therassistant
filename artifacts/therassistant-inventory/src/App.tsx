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
import { SettingsPage } from "./domains/settings/SettingsPage";
import {
  ADMIN_SETTINGS_DEFAULT_PATH,
  MEMBER_SETTINGS_DEFAULT_PATH,
} from "./domains/settings/route-config";
import { ClientsPage } from "./pages/clients";
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
        <Route path="/settings"><Redirect to={ADMIN_SETTINGS_DEFAULT_PATH} /></Route>
        <Route path="/settings/:rest*"><SettingsPage mode="admin" /></Route>
        <Route path="/member/settings"><Redirect to={MEMBER_SETTINGS_DEFAULT_PATH} /></Route>
        <Route path="/member/settings/:rest*"><SettingsPage mode="member" /></Route>
        <Route path="/administration/imports"><ImportsPage /></Route>
        <Route path="/administration/database-inventory"><InventoryApp /></Route>
        <Route path="/administration/*?"><Redirect to={ADMIN_SETTINGS_DEFAULT_PATH} /></Route>
        <Route path="/"><Redirect to="/schedule" /></Route>
        <Route><div className="thera-state">Page not found.</div></Route>
      </Switch>
    </AppShell>
  );
}
