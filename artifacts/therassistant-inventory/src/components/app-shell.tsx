import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";

import {
  getVisibleWorkspaces,
  getWorkspaceContext,
  toggleExpandedWorkspace,
  type WorkspaceId,
} from "../navigation/workspaces";
import "../navigation/workspace-navigation.css";

type Props = {
  children: ReactNode;
};

export function AppShell({ children }: Props) {
  const [location] = useLocation();
  const context = getWorkspaceContext(location);
  const activeWorkspaceId = context.workspace?.id ?? null;
  const [expandedWorkspaceId, setExpandedWorkspaceId] = useState<WorkspaceId | null>(activeWorkspaceId);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (activeWorkspaceId) setExpandedWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId]);

  const topbarContext = context.workspace
    ? context.child
      ? `${context.workspace.label} · ${context.child.label}`
      : context.workspace.label
    : "Operational Workspace";

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

        <nav className="thera-nav" aria-label="Workspace navigation">
          {getVisibleWorkspaces().map((workspace) => {
            const expanded = workspace.id === expandedWorkspaceId;
            const activeWorkspace = workspace.id === activeWorkspaceId;

            return (
              <div className="thera-workspace" key={workspace.id}>
                <button
                  type="button"
                  className={activeWorkspace ? "thera-workspace-button active" : "thera-workspace-button"}
                  aria-expanded={expanded}
                  aria-controls={`thera-workspace-${workspace.id}`}
                  onClick={() =>
                    setExpandedWorkspaceId((current) => toggleExpandedWorkspace(current, workspace.id))
                  }
                >
                  <span className="thera-workspace-label">{workspace.label}</span>
                  <span className="thera-workspace-chevron" aria-hidden="true">
                    {expanded ? "⌄" : "›"}
                  </span>
                </button>

                <div
                  id={`thera-workspace-${workspace.id}`}
                  className="thera-workspace-children"
                  hidden={!expanded}
                >
                  {expanded
                    ? workspace.children.map((child) => {
                        const activeChild = context.child?.id === child.id;
                        return (
                          <Link
                            key={child.id}
                            href={child.href}
                            className={activeChild ? "thera-workspace-child active" : "thera-workspace-child"}
                            aria-current={activeChild ? "page" : undefined}
                            onClick={() => setMobileNavOpen(false)}
                          >
                            {child.label}
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
