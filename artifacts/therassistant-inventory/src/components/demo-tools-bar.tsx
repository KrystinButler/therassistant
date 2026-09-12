import {
  Link,
} from "wouter";

const links = [
  ["/demo", "Demo"],
  ["/journal", "Journal"],
  ["/medicaid", "Medicaid"],
  [
    "/claims/submission",
    "837P",
  ],
  [
    "/claims/follow-up",
    "Follow-Up",
  ],
  [
    "/administration/imports",
    "Imports",
  ],
] as const;

export function DemoToolsBar() {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        marginBottom: 12,
      }}
    >
      {links.map(
        ([href, label]) => (
          <Link
            key={href}
            href={href}
            className="thera-action secondary"
          >
            {label}
          </Link>
        ),
      )}
    </div>
  );
}
