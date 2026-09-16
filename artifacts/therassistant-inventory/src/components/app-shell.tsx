import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";

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
  const context = getNavigationContext(location);
  const activeSectionId = context.section?.id ?? null;
  const [expandedSectionId, setExpandedSectionId] = useState<SectionId | null>(activeSectionId);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (activeSectionId) setExpandedSectionId(activeSectionId);
  }, [activeSectionId]);

  const topbarContext = context.section
    ? context.item
      ? `${context.section.label} · ${context.item.label}`
      : context.section.label
    : "Operations";

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
            <div className="thera-brand-subtitle">Revenue Cycle Operations</div>
          </div>
        </div>

        <nav className="thera-nav" aria-label="Primary navigation">
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
          <div className="thera-practice-label">DEMO PRACTICE</div>
          <div className="thera-practice-name">Front Range Behavioral Health</div>
          <div className="thera-practice-meta">Therassistant Billing Services</div>
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
              <div className="thera-topbar-practice">Front Range Behavioral Health</div>
              <div className="thera-topbar-product">{topbarContext}</div>
            </div>
          </div>
          <div className="thera-demo-chip">SYNTHETIC DEMO DATA</div>
        </header>
        <section className="thera-content">{children}</section>
      </main>
    </div>
  );
}
