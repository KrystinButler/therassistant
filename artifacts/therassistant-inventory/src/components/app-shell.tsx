import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ClientSearchContext } from "../navigation/client-search-context";
import {
  Bell, BookOpenText, BriefcaseBusiness, CalendarDays, ChartNoAxesCombined,
  ChevronDown, ClipboardList, CreditCard, ExternalLink, FileText, Landmark, LayoutDashboard,
  LogOut, Menu, Search, Settings, UsersRound, UserRoundCog, X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { useTenant } from "../auth/tenant-context";
import { PORTAL_LOGIN } from "../domains/portal/routes";

type Props = { children: ReactNode };
type NavItem = { label: string; href: string; icon: LucideIcon; paths?: string[]; external?: boolean };
type NavGroup = { label?: string; items: NavItem[] };

const navigation: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Appointments", href: "/schedule", icon: CalendarDays, paths: ["/encounters"] },
      { label: "Clients", href: "/clients", icon: UsersRound },
      { label: "Clinical Notes", href: "/clinical", icon: FileText, paths: ["/clinical/golden-thread"] },
      { label: "Charge Capture", href: "/billing/charges", icon: ClipboardList, paths: ["/billing", "/charges"] },
      { label: "Claims", href: "/claims", icon: BriefcaseBusiness, paths: ["/rejections", "/denials", "/ar-denials"] },
      { label: "Payments", href: "/payments", icon: CreditCard },
      { label: "Reports", href: "/reports", icon: ChartNoAxesCombined },
    ],
  },
  {
    label: "PRACTICE",
    items: [
      { label: "Payers", href: "/payers-contracts", icon: Landmark, paths: ["/payers"] },
      { label: "Providers", href: "/providers", icon: UserRoundCog },
      { label: "Credentialing", href: "/credentialing", icon: ClipboardList },
      { label: "Patient Journal", href: "/journal", icon: BookOpenText },
      { label: "Portal Preview", href: "/portal-preview", icon: ExternalLink },
      { label: "Patient Portal", href: PORTAL_LOGIN, icon: ExternalLink, external: true },
      { label: "Work Center", href: "/work-center", icon: BriefcaseBusiness },
    ],
  },
];

function matches(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

export function AppShell({ children }: Props) {
  const [location, navigate] = useLocation();
  const { user, signOut } = useAuth();
  const { tenantName, roles } = useTenant();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [submittedClientSearch, setSubmittedClientSearch] = useState({ term: "", revision: 0 });

  useEffect(() => {
    setMobileOpen(false);
    setMobileSearchOpen(false);
    setProfileOpen(false);
  }, [location]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        setMobileSearchOpen(false);
        setProfileOpen(false);
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

  const displayName = useMemo(() => {
    const metadata = user?.user_metadata ?? {};
    const name = [metadata.first_name, metadata.last_name].filter(Boolean).join(" ");
    return String(metadata.display_name || metadata.full_name || name || user?.email || "Account").trim();
  }, [user]);
  const roleLabel = roles.length ? roles[0].replaceAll("_", " ") : "Staff";
  const initials = displayName.split(/[\s@]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
  const currentPage = navigation.flatMap((group) => group.items).find((item) =>
    matches(location, item.href) || item.paths?.some((path) => matches(location, path))
  )?.label ?? (location.startsWith("/administration") ? "Settings" : "Workspace");

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  function navLink(item: NavItem) {
    const active = matches(location, item.href) || item.paths?.some((path) => matches(location, path));
    const Icon = item.icon;
    const contents = <><Icon size={19} strokeWidth={1.75} aria-hidden="true" /><span>{item.label}</span></>;
    if (item.external) {
      // This is the real patient portal, not a staff impersonation mode.
      // A separate private browser session is required for simultaneous testing.
      return <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer"
        className="cw-nav-link" title="Open in a private window with an invited patient identity to test while staff remains signed in"
        onClick={() => setMobileOpen(false)}>{contents}<ExternalLink size={13} aria-hidden="true" /></a>;
    }
    return (
      <Link
        key={item.href}
        href={item.href}
        className={active ? "cw-nav-link active" : "cw-nav-link"}
        aria-current={active ? "page" : undefined}
        onClick={() => setMobileOpen(false)}
      >
        {contents}
      </Link>
    );
  }

  return (
    <ClientSearchContext.Provider value={submittedClientSearch}>
    <div className="thera-app cw-app">
      <header className="cw-global-header">
        <div className="cw-global-brand-area">
          <button
            className="cw-mobile-menu"
            type="button"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <Link href="/" className="cw-wordmark" aria-label="Therassistant EHR dashboard">
            <img className="cw-brand-emblem" src="/brand/favicon.webp" width={36} height={36} alt="" aria-hidden="true" />
            <span className="cw-wordmark-type">
              <strong>THERASSISTANT</strong>
              <small>EHR</small>
            </span>
          </Link>
        </div>
        <form className={mobileSearchOpen ? "cw-global-search mobile-search-open" : "cw-global-search"} role="search" onSubmit={(event) => {
          event.preventDefault();
          setSubmittedClientSearch((previous) => ({ term: clientSearch.trim(), revision: previous.revision + 1 }));
          setMobileSearchOpen(false);
          navigate("/clients");
        }}>
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            value={clientSearch}
            onChange={(event) => setClientSearch(event.target.value)}
            aria-label="Search clients"
            placeholder="Search clients by name, email or phone..."
          />
          <button type="submit" className="cw-search-submit" aria-label="Submit search"><Search size={17} /></button>
        </form>
        <div className="cw-header-actions">
          <button type="button" className="cw-mobile-search-toggle" aria-label={mobileSearchOpen ? "Close search" : "Search patients"} aria-expanded={mobileSearchOpen} onClick={() => setMobileSearchOpen((open) => !open)}>{mobileSearchOpen ? <X size={19} /> : <Search size={19} />}</button>
          <Link href="/work-center" className="cw-alert-link" aria-label="Open Work Center" title="Work Center">
            <Bell size={21} strokeWidth={1.7} aria-hidden="true" />
          </Link>
          <div className="cw-profile">
            <button
              type="button"
              className="cw-profile-trigger"
              onClick={() => setProfileOpen((open) => !open)}
              aria-expanded={profileOpen}
              aria-haspopup="menu"
            >
              <span className="cw-avatar">{initials || "T"}</span>
              <span className="cw-profile-copy"><strong>{displayName}</strong><small>{roleLabel}</small></span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {profileOpen ? (
              <div className="cw-profile-menu" role="menu" aria-label="Account">
                <p className="cw-profile-menu-org">{tenantName || "Therassistant"}</p>
                <p className="cw-profile-menu-email">{user?.email || displayName}</p>
                <Link href="/administration" role="menuitem" className="cw-profile-menu-action"><Settings size={16} /> Settings</Link>
                <button type="button" role="menuitem" onClick={() => void handleSignOut()} disabled={signingOut}>
                  <LogOut size={16} /> {signingOut ? "Signing out..." : "Sign out"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {mobileOpen ? (
        <button type="button" className="cw-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
      ) : null}
      <aside className={mobileOpen ? "thera-sidebar cw-sidebar mobile-open" : "thera-sidebar cw-sidebar"}>
        <nav className="cw-navigation" aria-label="Primary navigation">
          {navigation.map((group, index) => (
            <div className="cw-nav-group" key={group.label || "primary"}>
              {index > 0 ? <div className="cw-nav-divider" aria-hidden="true" /> : null}
              {group.label ? <span className="cw-nav-heading">{group.label}</span> : null}
              {group.items.map(navLink)}
            </div>
          ))}
        </nav>
        <div className="cw-sidebar-bottom">
          <Link
            href="/administration"
            className={location.startsWith("/administration") ? "cw-nav-link active" : "cw-nav-link"}
            aria-current={location.startsWith("/administration") ? "page" : undefined}
          >
            <Settings size={19} strokeWidth={1.75} aria-hidden="true" />
            <span>Settings</span>
          </Link>
          <div className="cw-sidebar-org">{tenantName || "Therassistant"}</div>
        </div>
      </aside>

      <main className="thera-main cw-main">
        <div className="cw-mobile-context">{currentPage}</div>
        <section className="thera-content cw-content">{children}</section>
      </main>
    </div>
    </ClientSearchContext.Provider>
  );
}
