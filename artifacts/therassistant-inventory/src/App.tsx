import { useEffect } from "react";
import { Route, Switch, useLocation, useRoute } from "wouter";

import { AuthProvider, useAuth } from "./auth/auth-context";
import { LoginPage } from "./auth/LoginPage";
import { OrganizationSetup } from "./auth/OrganizationSetup";
import { PasswordRecoveryPage } from "./auth/PasswordRecoveryPage";
import { TenantProvider, useTenant } from "./auth/tenant-context";
import { AppShell } from "./components/app-shell";
import { DenialsPage } from "./domains/ar/DenialsPage";
import { BillingHubPage } from "./domains/billing/BillingHubPage";
import { BillingQueuePage } from "./domains/billing/BillingQueuePage";
import { Claim360Page } from "./domains/claims/Claim360Page";
import { ClaimsPage } from "./domains/claims/ClaimsPage";
import { RejectionsPage } from "./domains/claims/RejectionsPage";
import { CredentialingPage } from "./domains/credentialing/CredentialingPage";
import { ClinicalPage } from "./domains/clinical/ClinicalPage";
import { PayersContractsPage } from "./domains/credentialing/PayersContractsPage";
import { EncounterPage } from "./domains/encounters/EncounterPage";
import { CorrespondencePage } from "./domains/mailroom/CorrespondencePage";
import { JournalPage } from "./domains/journal/JournalPage";
import { ImportsPage } from "./domains/imports/ImportsPage";
import { MailroomPage } from "./domains/mailroom/MailroomPage";
import { PaymentsPage } from "./domains/payments/PaymentsPage";
import { EligibilityPage } from "./domains/payer-readiness/EligibilityPage";
import { PatientChartPage } from "./domains/patients/PatientChartPage";
import { PatientCheckInPage } from "./domains/portal/PatientCheckInPage";
import { PatientJournalPage } from "./domains/portal/PatientJournalPage";
import { PatientPortalActivatePage } from "./domains/portal/PatientPortalActivatePage";
import { PatientPortalGate } from "./domains/portal/PatientPortalGate";
import { PatientPortalLoginPage } from "./domains/portal/PatientPortalLoginPage";
import { PatientPortalPage } from "./domains/portal/PatientPortalPage";
import { PatientPortalRecoveryPage } from "./domains/portal/PatientPortalRecoveryPage";
import {
  isPatientPortalPath,
  PORTAL_ACTIVATE,
  PORTAL_HOME,
  PORTAL_JOURNAL,
  PORTAL_LOGIN,
  PORTAL_RECOVER,
} from "./domains/portal/routes";
import { SchedulePage } from "./domains/scheduling/SchedulePage";
import { DashboardPage } from "./pages/dashboard";
import { WorkCenterPage } from "./pages/work-center";
import { AdministrationPage } from "./pages/administration";
import { AuditPage } from "./pages/audit";
import { ClientsPage } from "./pages/clients";
import { PayerDetailPage } from "./pages/payer-detail";
import { PracticeConfigurationPage } from "./pages/practice-configuration";
import { ProviderDetailPage } from "./pages/provider-detail";
import { ProvidersPage } from "./pages/providers";
import { ReportsPage } from "./pages/operational-workspaces";
import {
  GoldenThreadPage,
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

function StaffRoutes() {
  return (
    <AppShell>
      <Switch>
        <Route path="/clinical/golden-thread/:clientId"><GoldenThreadPage /></Route>
        <Route path="/claims/submission"><Redirect to="/billing/charges" /></Route>
        <Route path="/claims/follow-up"><Redirect to="/claims" /></Route>
        <Route path="/ar-denials"><Redirect to="/denials" /></Route>
        <Route path="/work-center"><WorkCenterPage /></Route>
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
        <Route path="/authorizations"><Redirect to="/eligibility" /></Route>
        <Route path="/medicaid"><MedicaidPage /></Route>
        <Route path="/billing"><BillingHubPage /></Route>
        <Route path="/claims"><ClaimsPage /></Route>
        <Route path="/payments"><PaymentsPage /></Route>
        <Route path="/credentialing"><CredentialingPage /></Route>
        <Route path="/payers-contracts"><PayersContractsPage /></Route>
        <Route path="/mailroom"><MailroomPage /></Route>
        <Route path="/reports"><ReportsPage /></Route>
        <Route path="/administration/imports"><ImportsPage /></Route>
        <Route path="/administration/audit"><AuditPage /></Route>
        <Route path="/administration/practices"><PracticeConfigurationPage /></Route>
        <Route path="/administration"><AdministrationPage /></Route>
        <Route path="/"><DashboardPage /></Route>
        <Route><div className="thera-state">Page not found.</div></Route>
      </Switch>
    </AppShell>
  );
}

function TenantGate() {
  const { loading, error, tenantId, needsOrganizationSetup } = useTenant();
  if (loading) return <div className="thera-state">Loading organization...</div>;
  if (error) return <div className="thera-state error">{error}</div>;
  if (needsOrganizationSetup) return <OrganizationSetup />;
  if (!tenantId) return <div className="thera-state error">No active organization is available.</div>;
  return <StaffRoutes />;
}

function StaffGate() {
  const { session, loading, passwordRecovery } = useAuth();
  if (loading) return <div className="thera-state">Checking session...</div>;
  if (!session) return <LoginPage />;
  if (passwordRecovery) return <PasswordRecoveryPage />;
  return (
    <TenantProvider>
      <TenantGate />
    </TenantProvider>
  );
}

function PatientAuthenticatedRoutes() {
  return (
    <PatientPortalGate>
      <Switch>
        <Route path="/patient-portal/check-in/:appointmentId"><PatientCheckInPage /></Route>
        <Route path={PORTAL_JOURNAL}><PatientJournalPage /></Route>
        <Route path={PORTAL_HOME}><PatientPortalPage /></Route>
        <Route><div className="thera-state">Patient portal page not found.</div></Route>
      </Switch>
    </PatientPortalGate>
  );
}

function PatientPortalRoutes() {
  return (
    <Switch>
      <Route path={PORTAL_LOGIN}><PatientPortalLoginPage /></Route>
      <Route path={PORTAL_ACTIVATE}><PatientPortalActivatePage /></Route>
      <Route path={PORTAL_RECOVER}><PatientPortalRecoveryPage /></Route>
      <Route><PatientAuthenticatedRoutes /></Route>
    </Switch>
  );
}

function ApplicationRoutes() {
  const [location] = useLocation();
  return isPatientPortalPath(location) ? <PatientPortalRoutes /> : <StaffGate />;
}

export default function App() {
  return (
    <AuthProvider>
      <ApplicationRoutes />
    </AuthProvider>
  );
}
