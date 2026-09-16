import type { ReactNode } from "react";
import { Link } from "wouter";
import "./portal.css";

export type PortalSection = "home" | "journal" | "check-in" | "access";

type PortalShellProps = {
  clientId: string;
  patientName: string;
  active: PortalSection;
  nextAppointmentId?: string | null;
  children: ReactNode;
  sideRail?: ReactNode;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "PT";
}

export function PortalShell({
  clientId,
  patientName,
  active,
  nextAppointmentId,
  children,
  sideRail,
}: PortalShellProps) {
  const home = `/patient-portal/${clientId}`;
  const journal = `${home}/journal`;
  const access = `${home}/access`;
  const checkIn = nextAppointmentId ? `${home}/check-in/${nextAppointmentId}` : null;

  return (
    <div className="portal-app">
      <header className="portal-topbar">
        <Link href={home} className="portal-brand" aria-label="THERASSISTANT patient portal home">
          <span className="portal-brand-mark" aria-hidden="true">TA</span>
          <span>
            <strong>THERASSISTANT EHR</strong>
            <small>Behavioral Health · Patient Portal</small>
          </span>
        </Link>
        <div className="portal-account">
          <div>
            <span>Welcome,</span>
            <strong>{patientName}</strong>
          </div>
          <span className="portal-avatar" aria-hidden="true">{initials(patientName)}</span>
        </div>
      </header>

      <div className="portal-layout">
        <aside className="portal-sidebar" aria-label="Patient portal navigation">
          <div className="portal-welcome">
            <span>Welcome back,</span>
            <strong>{patientName.split(/\s+/)[0] || patientName}</strong>
            <p>Progress happens between sessions, too.</p>
          </div>

          <nav className="portal-nav">
            <Link className={active === "home" ? "portal-nav-link active" : "portal-nav-link"} href={home}>
              Home
            </Link>
            <Link className={active === "journal" ? "portal-nav-link active" : "portal-nav-link"} href={journal}>
              Journal
            </Link>
            {checkIn ? (
              <Link className={active === "check-in" ? "portal-nav-link active" : "portal-nav-link"} href={checkIn}>
                Check-In
              </Link>
            ) : (
              <span className="portal-nav-link disabled" aria-disabled="true">Check-In</span>
            )}
            <Link className={active === "access" ? "portal-nav-link active" : "portal-nav-link"} href={access}>
              Billing & Access
            </Link>
          </nav>

          <div className="portal-sidebar-note">
            <strong>Care today. A healthier tomorrow.</strong>
            <span>THERASSISTANT keeps your visit preparation, reflections, and practice information in one place.</span>
          </div>
        </aside>

        <main className={sideRail ? "portal-main with-rail" : "portal-main"}>
          <div className="portal-content">{children}</div>
          {sideRail ? <aside className="portal-side-rail">{sideRail}</aside> : null}
        </main>
      </div>
    </div>
  );
}
