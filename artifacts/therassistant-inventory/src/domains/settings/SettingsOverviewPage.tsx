import { Link } from "wouter";

import { SETTINGS_GROUPS } from "./settings-groups";

export function SettingsOverviewPage() {
  return (
    <>
      <div className="thera-page-header">
        <div>
          <div className="thera-eyebrow">PRACTICE CONFIGURATION</div>
          <h1>Settings</h1>
          <p>Manage practice, clinical, billing, administration, and account settings.</p>
        </div>
      </div>

      <div className="thera-stack">
        {SETTINGS_GROUPS.map((group) => (
          <section className="thera-card" key={group.id}>
            <div className="thera-card-header">
              <div>
                <h2>{group.label}</h2>
              </div>
            </div>
            <div className="thera-admin-grid">
              {group.items.map((item) => (
                <div className="thera-card" key={item.id}>
                  <h3>{item.label}</h3>
                  <p>{item.description}</p>
                  <Link href={item.href} className="thera-button">
                    Open
                  </Link>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export function SettingsPlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <div className="thera-breadcrumb">
        <Link href="/settings" className="thera-link">Settings</Link>
        <span>/</span>
        <span>{title}</span>
      </div>
      <div className="thera-page-header">
        <div>
          <div className="thera-eyebrow">SETTINGS</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <div className="thera-card">
        <div className="thera-state">Configuration controls are being connected.</div>
      </div>
    </>
  );
}
