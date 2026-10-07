import type { ReactNode } from "react";
import { Link, Route, Switch, useLocation } from "wouter";

import { useTenant } from "../../auth/tenant-context";
import { PayerDetailPage } from "../../pages/payer-detail";
import { CredentialingPage } from "./CredentialingPage";
import { ParticipationVerificationPage } from "./ParticipationVerificationPage";
import { PayersContractsPage } from "./PayersContractsPage";

function moduleMatch(path: string, href: string) {
  return path === href || path.startsWith(`${href}/`);
}

function CredentialingModuleShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { tenantName } = useTenant();

  return (
    <div className="thera-app cw-app" data-module="credentialing">
      <header className="cw-global-header">
        <div className="cw-global-brand-area">
          <Link href="/credentialing" className="cw-wordmark" aria-label="Therassistant Credentialing home">
            <img className="cw-brand-emblem" src="/brand/favicon.webp" width={36} height={36} alt="" aria-hidden="true" />
            <span className="cw-wordmark-type">
              <strong>THERASSISTANT</strong>
              <small>CREDENTIALING</small>
            </span>
          </Link>
        </div>
        <div className="cw-header-actions">
          <span className="cw-sidebar-org">{tenantName || "Therassistant"}</span>
          <Link href="/" className="thera-action secondary">Return to EHR</Link>
        </div>
      </header>

      <aside className="thera-sidebar cw-sidebar">
        <nav className="cw-navigation" aria-label="Credentialing navigation">
          <div className="cw-nav-group">
            <span className="cw-nav-heading">CREDENTIALING</span>
            <Link
              href="/credentialing"
              className={location === "/credentialing" ? "cw-nav-link active" : "cw-nav-link"}
              aria-current={location === "/credentialing" ? "page" : undefined}
            >
              <span>Workqueue & Applications</span>
            </Link>
            <Link
              href="/credentialing/participation"
              className={moduleMatch(location, "/credentialing/participation") ? "cw-nav-link active" : "cw-nav-link"}
              aria-current={moduleMatch(location, "/credentialing/participation") ? "page" : undefined}
            >
              <span>Verify Participation</span>
            </Link>
            <Link
              href="/credentialing/payers"
              className={moduleMatch(location, "/credentialing/payers") ? "cw-nav-link active" : "cw-nav-link"}
              aria-current={moduleMatch(location, "/credentialing/payers") ? "page" : undefined}
            >
              <span>Payers & Contracts</span>
            </Link>
          </div>
        </nav>
        <div className="cw-sidebar-bottom">
          <Link href="/providers" className="cw-nav-link">Provider Directory in EHR</Link>
          <div className="cw-sidebar-org">Credentialing operates independently from claim workflow.</div>
        </div>
      </aside>

      <main id="main-content" tabIndex={-1} className="thera-main cw-main">
        <section className="thera-content cw-content">{children}</section>
      </main>
    </div>
  );
}

export function CredentialingModuleApp() {
  return (
    <CredentialingModuleShell>
      <Switch>
        <Route path="/credentialing/participation"><ParticipationVerificationPage /></Route>
        <Route path="/credentialing/payers/:id"><PayerDetailPage /></Route>
        <Route path="/credentialing/payers"><PayersContractsPage /></Route>
        <Route path="/credentialing"><CredentialingPage /></Route>
        <Route><div className="thera-state">Credentialing page not found.</div></Route>
      </Switch>
    </CredentialingModuleShell>
  );
}
