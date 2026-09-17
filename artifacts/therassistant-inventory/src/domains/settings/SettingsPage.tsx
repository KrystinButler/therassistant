import { Link, useLocation } from "wouter";

import {
  ADMIN_SETTINGS_SECTIONS,
  MEMBER_SETTINGS_SECTIONS,
  SETTINGS_LABELS_BY_SECTION,
  getSettingsSectionByRoute,
  getSettingsSectionStatus,
  type SettingsSection,
} from "./model";
import { ADMIN_SETTINGS_GROUPS, MEMBER_SETTINGS_GROUPS } from "./route-config";

type SettingsPageProps = {
  mode: "admin" | "member";
};

function getMemberSection(pathname: string): SettingsSection | undefined {
  const member = MEMBER_SETTINGS_SECTIONS.find(
    (section) => pathname === section.path || pathname.startsWith(`${section.path}/`),
  );
  if (!member) return undefined;

  return {
    slug: member.slug,
    label: member.label,
    path: member.path,
    group: member.group,
  };
}

export function SettingsPage({ mode }: SettingsPageProps) {
  const [location] = useLocation();
  const section = mode === "admin" ? getSettingsSectionByRoute(location) : getMemberSection(location);
  const groups = mode === "admin" ? ADMIN_SETTINGS_GROUPS : MEMBER_SETTINGS_GROUPS;

  if (!section) {
    return <div className="thera-state">Settings page not found.</div>;
  }

  const status = getSettingsSectionStatus(section.slug);
  const labels = SETTINGS_LABELS_BY_SECTION[section.slug];

  return (
    <div className="thera-settings-page">
      <header className="thera-page-header">
        <div>
          <div className="thera-page-kicker">Configuration</div>
          <h1>Settings</h1>
          <p>Manage practice, workflow, platform, and account configuration from one place.</p>
        </div>
      </header>

      <div className="thera-settings-layout">
        <aside className="thera-settings-nav" aria-label="Settings navigation">
          {groups.map((group) => (
            <section key={group.label} className="thera-settings-nav-group">
              <div className="thera-settings-nav-label">{group.label}</div>
              {group.items.map((item) => (
                <Link
                  key={item.path}
                  href={item.path}
                  className={item.path === section.path ? "thera-settings-nav-item active" : "thera-settings-nav-item"}
                  aria-current={item.path === section.path ? "page" : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </section>
          ))}
        </aside>

        <main className="thera-settings-content">
          <div className="thera-card thera-stack">
            <div className="thera-card-header">
              <div>
                <div className="thera-page-kicker">{section.group}</div>
                <h2>{section.label}</h2>
              </div>
              <div aria-label="Settings status">
                <div className="thera-page-kicker">Settings status</div>
                <strong>{status}</strong>
              </div>
            </div>

            {labels.length > 0 ? (
              <div className="thera-stack">
                {labels.map((label) => (
                  <div className="thera-card" key={label}>
                    <strong>{label}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="thera-state">Configuration controls are not connected yet.</div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export const SETTINGS_PAGE_COUNT = ADMIN_SETTINGS_SECTIONS.length;
