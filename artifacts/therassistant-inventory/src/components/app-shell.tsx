import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";

type Props = {
  children: ReactNode;
};

const navigation = [
  ["Home", "/"],
  ["Work Center", "/work-center"],
  ["Clients", "/clients"],
  ["Schedule", "/schedule"],
  ["Clinical", "/clinical"],
  ["Eligibility", "/eligibility"],
  ["Authorizations", "/authorizations"],
  ["Billing", "/billing"],
  ["Claims", "/claims"],
  ["Payments", "/payments"],
  ["A/R & Denials", "/ar-denials"],
  ["Providers", "/providers"],
  ["Credentialing", "/credentialing"],
  ["Payers & Contracts", "/payers-contracts"],
  ["Mailroom", "/mailroom"],
  ["Reports", "/reports"],
  ["Administration", "/administration"],
] as const;

export function AppShell({ children }: Props) {
  const [location] = useLocation();

  function active(href: string) {
    if (href === "/") return location === "/";
    return location === href || location.startsWith(`${href}/`);
  }

  return (
    <div className="thera-app">
      <aside className="thera-sidebar">
        <div className="thera-brand">
          <div className="thera-brand-mark">T</div>
          <div>
            <div className="thera-brand-name">THERASSISTANT</div>
            <div className="thera-brand-subtitle">Revenue Cycle Operations</div>
          </div>
        </div>

        <nav className="thera-nav">
          {navigation.map(([name, href]) => (
            <Link
              key={href}
              href={href}
              className={active(href) ? "thera-nav-link active" : "thera-nav-link"}
            >
              {name}
            </Link>
          ))}
        </nav>

        <div className="thera-sidebar-footer">
          <div className="thera-practice-label">DEMO PRACTICE</div>
          <div className="thera-practice-name">Front Range Behavioral Health</div>
          <div className="thera-practice-meta">Therassistant Billing Services</div>
        </div>
      </aside>

      <main className="thera-main">
        <header className="thera-topbar">
          <div><div className="thera-topbar-product">Operational Workspace</div></div>
          <div className="thera-demo-chip">SYNTHETIC DEMO DATA</div>
        </header>
        <section className="thera-content">{children}</section>
      </main>
    </div>
  );
}
