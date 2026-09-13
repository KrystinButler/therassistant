import {
  Route,
  Switch,
} from "wouter";

import InventoryApp from "./InventoryApp";

import {
  AppShell,
} from "./components/app-shell";

import { SchedulePage } from "./domains/scheduling/SchedulePage";
import { PreSessionPage } from "./domains/scheduling/PreSessionPage";

import {
  DashboardPage,
} from "./pages/dashboard";

import {
  ClientsPage,
} from "./pages/clients";

import {
  ClientDetailPage,
} from "./pages/client-detail";

import {
  ClaimsPage,
} from "./pages/claims";

import {
  ClaimDetailPage,
} from "./pages/claim-detail";

import {
  WorkCenterPage,
} from "./pages/work-center";

import {
  ProvidersPage,
} from "./pages/providers";

import {
  ProviderDetailPage,
} from "./pages/provider-detail";

import {
  AdministrationPage,
} from "./pages/administration";

import {
  DemoControlCenter,
} from "./pages/demo-control";

import {
  ChargesPage,
  PaymentsPage,
  ArDenialsPage,
  CredentialingPage,
  PayersContractsPage,
  MailroomPage,
  ReportsPage,
} from "./pages/operational-workspaces";

import {
  ClinicalPage,
  EligibilityPage,
  AuthorizationsPage,
  MedicaidPage,
  ImportsPage,
  JournalPage,
  ClaimSubmissionPage,
  ClaimFollowUpPage,
  GoldenThreadPage,
  PatientPortalPage,
} from "./pages/restored-modules";

export default function App() {
  return (
    <AppShell>
      <Switch>
        <Route path="/demo">
          <DemoControlCenter />
        </Route>

        <Route path="/patient-portal/:clientId">
          <PatientPortalPage />
        </Route>

        <Route path="/clinical/golden-thread/:clientId">
          <GoldenThreadPage />
        </Route>

        <Route path="/claims/submission">
          <ClaimSubmissionPage />
        </Route>

        <Route path="/claims/follow-up">
          <ClaimFollowUpPage />
        </Route>

        <Route path="/schedule/:id">
          <PreSessionPage />
        </Route>

        <Route path="/clients/:id">
          <ClientDetailPage />
        </Route>

        <Route path="/claims/:id">
          <ClaimDetailPage />
        </Route>

        <Route path="/providers/:id">
          <ProviderDetailPage />
        </Route>

        <Route path="/work-center">
          <WorkCenterPage />
        </Route>

        <Route path="/clients">
          <ClientsPage />
        </Route>

        <Route path="/providers">
          <ProvidersPage />
        </Route>

        <Route path="/schedule">
          <SchedulePage />
        </Route>

        <Route path="/clinical">
          <ClinicalPage />
        </Route>

        <Route path="/journal">
          <JournalPage />
        </Route>

        <Route path="/eligibility">
          <EligibilityPage />
        </Route>

        <Route path="/authorizations">
          <AuthorizationsPage />
        </Route>

        <Route path="/medicaid">
          <MedicaidPage />
        </Route>

        <Route path="/charges">
          <ChargesPage />
        </Route>

        <Route path="/claims">
          <ClaimsPage />
        </Route>

        <Route path="/payments">
          <PaymentsPage />
        </Route>

        <Route path="/ar-denials">
          <ArDenialsPage />
        </Route>

        <Route path="/credentialing">
          <CredentialingPage />
        </Route>

        <Route path="/payers-contracts">
          <PayersContractsPage />
        </Route>

        <Route path="/mailroom">
          <MailroomPage />
        </Route>

        <Route path="/reports">
          <ReportsPage />
        </Route>

        <Route path="/administration/imports">
          <ImportsPage />
        </Route>

        <Route path="/administration/database-inventory">
          <InventoryApp />
        </Route>

        <Route path="/administration">
          <AdministrationPage />
        </Route>

        <Route path="/">
          <DashboardPage />
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
