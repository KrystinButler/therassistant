import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";

import { useAuth } from "../auth/auth-context";
import { useTenant } from "../auth/tenant-context";
import {
  getNavigationContext,
  getVisibleSections,
  toggleExpandedSection,
  type SectionId,
} from "../navigation/sections";
import "../navigation/workspace-navigation.css";

type Props = {
  children: ReactNode;
};

export function AppShell({ children }: Props) {
  const [location] = useLocation();
  const { user, signOut } = useAuth();
  const { tenantName, roles } = useTenant();
  const context = getNavigationContext(location);
  const activeSectionId = context.section?.id ?? null;
  const [expandedSectionId, setExpandedSectionId] = useState<SectionId | null>(activeSectionId);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (activeSectionId) setExpandedSectionId(activeSectionId);
  }, [activeSectionId]);

  const topbarContext = context.section
    ? context.item
      ? `${context.section.label} · ${context.item.label}`
      : context.section.label
    : location === "/" ? "Home · Connected Workflow" : "Operations";

  const userLabel = useMemo(() => {
    const metadata = user?.user_metadata ?? {};
    const name = [metadata.first_name, metadata.last_name].filter(Boolean).join(" ").trim();
    return String(metadata.display_name ?? metadata.full_name ?? name ?? "").trim() || user?.email || "Signed-in user";
  }, [user]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="thera-app">
      {mobileNavOpen ? (
        <button
          type="button"
          className="thera-sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside className={mobileNavOpen ? "thera-sidebar mobile-open" : "thera-sidebar"}>
        <div className="thera-brand">
          <div className="thera-brand-mark">T</div>
          <div>
            <div className="thera-brand-name">THERASSISTANT</div>
            <div className="thera-brand-subtitle">Behavioral Health EHR + RCM</div>
          </div>
        </div>

        <nav className="thera-nav" aria-label="Primary navigation">
          <Link
            href="/"
            className={location === "/" ? "thera-home-link active" : "thera-home-link"}
            aria-current={location === "/" ? "page" : undefined}
            onClick={() => setMobileNavOpen(false)}
          >
            <span>Home</span>
            <span className="thera-home-link-subtitle">Connected workflow</span>
          </Link>

          {getVisibleSections().map((section) => {
            const expanded = section.id === expandedSectionId;
            const activeSection = section.id === activeSectionId;

            return (
              <div className="thera-workspace" key={section.id}>
                <button
                  type="button"
                  className={activeSection ? "thera-workspace-button active" : "thera-workspace-button"}
                  aria-expanded={expanded}
                  aria-controls={`thera-section-${section.id}`}
                  onClick={() =>
                    setExpandedSectionId((current) => toggleExpandedSection(current, section.id))
                  }
                >
                  <span className="thera-workspace-label">{section.label}</span>
                  <span className="thera-workspace-chevron" aria-hidden="true">
                    {expanded ? "⌄" : "›"}
                  </span>
                </button>

                <div
                  id={`thera-section-${section.id}`}
                  className="thera-workspace-children"
                  hidden={!expanded}
                >
                  {expanded
                    ? section.children.map((item) => {
                        const activeItem = context.item?.id === item.id;
                        return (
                          <Link
                            key={item.id}
                            href={item.href}
                            className={activeItem ? "thera-workspace-child active" : "thera-workspace-child"}
                            aria-current={activeItem ? "page" : undefined}
                            onClick={() => setMobileNavOpen(false)}
                          >
                            {item.label}
                          </Link>
                        );
                      })
                    : null}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="thera-sidebar-footer">
          <div className="thera-practice-label">ORGANIZATION</div>
          <div className="thera-practice-name">{tenantName ?? "Therassistant"}</div>
          <div className="thera-practice-meta">{user?.email ?? userLabel}</div>
        </div>
      </aside>

      <main className="thera-main">
        <header className="thera-topbar">
          <div className="thera-topbar-leading">
            <button
              type="button"
              className="thera-sidebar-toggle"
              aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              ☰
            </button>
            <div className="thera-topbar-context">
              <div className="thera-topbar-practice">{tenantName ?? "Therassistant"}</div>
              <div className="thera-topbar-product">{topbarContext}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="thera-practice-meta">{roles.length ? roles.join(" · ").replaceAll("_", " ") : userLabel}</div>
            <button type="button" className="thera-action secondary" onClick={() => void handleSignOut()} disabled={signingOut}>
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </header>
        <section className="thera-content">{children}</section>
      </main>
    </div>
  );
}
