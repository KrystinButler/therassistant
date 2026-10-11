import { useState } from "react";
import { BookOpenText, CalendarDays, CreditCard, Heart, Home, LogOut, MessageSquare, UserRound } from "lucide-react";
import { useLocation } from "wouter";

import { useAuth } from "../../auth/auth-context";
import { PORTAL_HOME, PORTAL_JOURNAL, PORTAL_LOGIN } from "./routes";
import "./patient-portal-nav.css";

export type PatientPortalNavKey = "home" | "appointments" | "journal" | "checkin" | "messages" | "billing" | "profile";

type Props = {
  active?: PatientPortalNavKey;
  checkInHref?: string;
};

const homeAnchors = {
  appointments: `${PORTAL_HOME}#appointments`,
  messages: `${PORTAL_HOME}#messages`,
  billing: `${PORTAL_HOME}#billing`,
  profile: `${PORTAL_HOME}#profile`,
};

function PatientPortalLogoutButton({ mobile = false }: { mobile?: boolean }) {
  const { signOut } = useAuth();
  const [, navigate] = useLocation();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await signOut();
      navigate(PORTAL_LOGIN, { replace: true });
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <button
      type="button"
      className={`ppn-logout${mobile ? " mobile" : ""}`}
      disabled={loggingOut}
      onClick={() => void handleLogout()}
      aria-label="Log out of patient portal"
    >
      <LogOut size={mobile ? 19 : 17} />
      {mobile ? <span>{loggingOut ? "Logging out…" : "Log Out"}</span> : (loggingOut ? "Logging out…" : "Log Out")}
    </button>
  );
}

export function PatientPortalNavigation({ active, checkInHref }: Props) {
  const items = [
    { key: "home" as const, href: PORTAL_HOME, label: "Home", icon: Home },
    { key: "appointments" as const, href: homeAnchors.appointments, label: "Appointments", icon: CalendarDays },
    { key: "journal" as const, href: PORTAL_JOURNAL, label: "Journal", icon: BookOpenText },
    { key: "checkin" as const, href: checkInHref ?? homeAnchors.appointments, label: "Check-In", icon: Heart },
    { key: "messages" as const, href: homeAnchors.messages, label: "Messages", icon: MessageSquare },
    { key: "billing" as const, href: homeAnchors.billing, label: "Billing", icon: CreditCard },
    { key: "profile" as const, href: homeAnchors.profile, label: "Profile", icon: UserRound },
  ];

  return (
    <nav className="pj-nav" aria-label="Patient portal navigation">
      {items.map((item) => {
        const Icon = item.icon;
        return <a key={item.key} href={item.href} className={active === item.key ? "active" : undefined}><Icon size={17} /> {item.label}</a>;
      })}
      <PatientPortalLogoutButton />
    </nav>
  );
}

export function PatientPortalMobileNavigation({ active }: Pick<Props, "active">) {
  const items = [
    { key: "home" as const, href: PORTAL_HOME, label: "Home", icon: Home },
    { key: "appointments" as const, href: homeAnchors.appointments, label: "Visits", icon: CalendarDays },
    { key: "journal" as const, href: PORTAL_JOURNAL, label: "Journal", icon: BookOpenText },
    { key: "messages" as const, href: homeAnchors.messages, label: "Messages", icon: MessageSquare },
    { key: "billing" as const, href: homeAnchors.billing, label: "Billing", icon: CreditCard },
    { key: "profile" as const, href: homeAnchors.profile, label: "Profile", icon: UserRound },
  ];

  return (
    <nav className="ppn-mobile" aria-label="Patient portal mobile navigation">
      {items.map((item) => {
        const Icon = item.icon;
        return <a key={item.key} href={item.href} className={active === item.key ? "active" : undefined}><Icon size={19} /><span>{item.label}</span></a>;
      })}
      <PatientPortalLogoutButton mobile />
    </nav>
  );
}
