type Props = {
  eyebrow: string;
  title: string;
  description: string;
  capabilities: string[];
};

export function ModulePlaceholder({
  eyebrow,
  title,
  description,
  capabilities,
}: Props) {
  return (
    <>
      <div className="thera-page-header">
        <div>
          <div className="thera-eyebrow">
            {eyebrow}
          </div>

          <h1>{title}</h1>

          <p>{description}</p>
        </div>
      </div>

      <section className="thera-card">
        <div className="thera-module-banner">
          <div>
            <div className="thera-eyebrow">
              THERASSISTANT UNIQUE WORKFLOW
            </div>

            <h2>Module shell is connected.</h2>

            <p>
              The workflow-specific data and actions
              will be activated in the next build
              phase.
            </p>
          </div>
        </div>

        <div className="thera-capability-grid">
          {capabilities.map((capability) => (
            <div
              className="thera-capability"
              key={capability}
            >
              <span className="thera-capability-dot" />
              {capability}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
