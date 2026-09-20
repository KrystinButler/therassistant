import { Link } from "wouter";

export function AdministrationPage() {
  const tools = [
    {
      name: "Providers",
      description:
        "Provider operational workspace and billing-readiness issues.",
      href: "/providers",
      available: true,
    },
    {
      name: "Users & Roles",
      description:
        "Tenant users, role assignments, and access control.",
      href: "/administration/users",
      available: false,
    },
    {
      name: "Audit & PHI Access",
      description:
        "System activity and protected-health-information access history.",
      href: "/administration/audit",
      available: false,
    },
    {
      name: "Practice Configuration",
      description:
        "Practice identity, billing provider, clearinghouse, and 837P payer configuration.",
      href: "/administration/practices",
      available: true,
    },
  ];

  return (
    <>
      <div className="thera-page-header">
        <div>
          <div className="thera-eyebrow">
            SYSTEM CONTROL
          </div>

          <h1>Administration</h1>

          <p>
            Configuration, access control, auditing,
            and practice management.
          </p>
        </div>
      </div>

      <div className="thera-admin-grid">
        {tools.map((tool) => (
          <div
            className="thera-card"
            key={tool.name}
          >
            <h2>{tool.name}</h2>
            <p>{tool.description}</p>

            {tool.available ? (
              <Link
                href={tool.href}
                className="thera-button"
              >
                Open
              </Link>
            ) : (
              <span className="thera-coming">
                Not yet available
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
