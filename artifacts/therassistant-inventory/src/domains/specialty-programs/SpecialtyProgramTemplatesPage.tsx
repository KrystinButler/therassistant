import { useEffect, useMemo, useState } from "react";

import {
  SPECIALTY_PROGRAM_ITEM_TYPES,
  itemTypeLabel,
  type SpecialtyProgramItemType,
  type SpecialtyProgramStatus,
  type SpecialtyProgramTemplate,
  type SpecialtyProgramTemplateItem,
} from "./model";
import {
  createSpecialtyProgramTemplate,
  createSpecialtyProgramTemplateItem,
  deleteSpecialtyProgramTemplateItem,
  getSpecialtyProgramTemplates,
  updateSpecialtyProgramTemplate,
  updateSpecialtyProgramTemplateItem,
} from "./repository";

const statuses: SpecialtyProgramStatus[] = ["draft", "active", "inactive", "archived"];

export function SpecialtyProgramTemplatesPage() {
  const [templates, setTemplates] = useState<SpecialtyProgramTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newItemType, setNewItemType] = useState<SpecialtyProgramItemType>("documentation_requirement");
  const [newItemLabel, setNewItemLabel] = useState("");
  const [newItemDescription, setNewItemDescription] = useState("");
  const [newItemRequired, setNewItemRequired] = useState(false);

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? templates[0] ?? null,
    [templates, selectedId],
  );

  async function reload(preferredId?: string) {
    setLoading(true);
    setError("");
    try {
      const next = await getSpecialtyProgramTemplates();
      setTemplates(next);
      const nextId = preferredId || selectedId;
      setSelectedId(next.some((item) => item.id === nextId) ? nextId : next[0]?.id ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load specialty program templates.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  function patchSelected(values: Partial<SpecialtyProgramTemplate>) {
    if (!selected) return;
    setTemplates((current) => current.map((template) =>
      template.id === selected.id ? { ...template, ...values } : template
    ));
  }

  function patchItem(itemId: string, values: Partial<SpecialtyProgramTemplateItem>) {
    if (!selected) return;
    setTemplates((current) => current.map((template) =>
      template.id !== selected.id
        ? template
        : {
            ...template,
            items: template.items.map((item) => item.id === itemId ? { ...item, ...values } : item),
          }
    ));
  }

  async function addTemplate() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const created = await createSpecialtyProgramTemplate({
        name: newName,
        category: newCategory,
        description: newDescription,
      });
      setNewName("");
      setNewCategory("");
      setNewDescription("");
      await reload(created.id);
      setMessage("Program template created. Add or edit requirements below.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create program template.");
    } finally {
      setSaving(false);
    }
  }

  async function saveTemplate() {
    if (!selected) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await updateSpecialtyProgramTemplate(selected.id, selected);
      await reload(selected.id);
      setMessage("Program template saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save program template.");
    } finally {
      setSaving(false);
    }
  }

  async function addItem() {
    if (!selected) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const maxSort = selected.items.reduce((max, item) => Math.max(max, item.sortOrder), 0);
      await createSpecialtyProgramTemplateItem({
        templateId: selected.id,
        itemType: newItemType,
        label: newItemLabel,
        description: newItemDescription,
        isRequired: newItemRequired,
        sortOrder: maxSort + 10,
      });
      setNewItemType("documentation_requirement");
      setNewItemLabel("");
      setNewItemDescription("");
      setNewItemRequired(false);
      await reload(selected.id);
      setMessage("Program requirement added.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add program requirement.");
    } finally {
      setSaving(false);
    }
  }

  async function saveItem(item: SpecialtyProgramTemplateItem) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await updateSpecialtyProgramTemplateItem(item.id, item);
      await reload(selected?.id);
      setMessage("Program requirement saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save program requirement.");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(item: SpecialtyProgramTemplateItem) {
    if (!window.confirm(`Remove "${item.label}" from this program template?`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await deleteSpecialtyProgramTemplateItem(item.id);
      await reload(selected?.id);
      setMessage("Program requirement removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove program requirement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="thera-page-header">
        <div>
          <div className="thera-eyebrow">SETTINGS · CLINICAL PROGRAM CONFIGURATION</div>
          <h1>Specialty Program Templates</h1>
          <p>
            Configure program-specific documentation, assessments, progress measures,
            reporting requirements, milestones, and forms without hard-coding clinical rules.
          </p>
        </div>
      </div>

      <div className="thera-alert" style={{ marginBottom: 12 }}>
        Starter templates provide structure only. They are not legal, regulatory, payer, or clinical
        requirements until your practice configures and validates the content.
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="thera-card" style={{ marginBottom: 12 }}>
        <div className="thera-card-header">
          <div>
            <div className="thera-eyebrow">NEW TEMPLATE</div>
            <h2>Create Program Template</h2>
          </div>
        </div>
        <div className="thera-form-grid">
          <label>
            Program name
            <input className="thera-input" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g., Specialty Court Program" />
          </label>
          <label>
            Category
            <input className="thera-input" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="e.g., specialty_court" />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Description
            <input className="thera-input" value={newDescription} onChange={(event) => setNewDescription(event.target.value)} />
          </label>
        </div>
        <button type="button" className="thera-action" style={{ marginTop: 10 }} disabled={saving || !newName.trim()} onClick={() => void addTemplate()}>
          + Create Template
        </button>
      </div>

      {loading ? (
        <div className="thera-state">Loading program templates...</div>
      ) : templates.length === 0 ? (
        <div className="thera-state">No specialty program templates are configured.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, .75fr) minmax(0, 2.25fr)", gap: 12, alignItems: "start" }}>
          <aside className="thera-card" style={{ padding: 12 }}>
            <div className="thera-field-label">Program templates</div>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {templates.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  className={template.id === selected?.id ? "thera-action" : "thera-action secondary"}
                  style={{ textAlign: "left", justifyContent: "flex-start" }}
                  onClick={() => setSelectedId(template.id)}
                >
                  {template.name}
                </button>
              ))}
            </div>
          </aside>

          {selected && (
            <div style={{ display: "grid", gap: 12 }}>
              <section className="thera-card">
                <div className="thera-card-header">
                  <div>
                    <div className="thera-eyebrow">PROGRAM CONFIGURATION</div>
                    <h2>{selected.name}</h2>
                    <p>{selected.items.length} configurable requirement{selected.items.length === 1 ? "" : "s"}</p>
                  </div>
                </div>

                <div className="thera-form-grid">
                  <label>
                    Name
                    <input className="thera-input" value={selected.name} onChange={(event) => patchSelected({ name: event.target.value })} />
                  </label>
                  <label>
                    Category
                    <input className="thera-input" value={selected.category} onChange={(event) => patchSelected({ category: event.target.value })} />
                  </label>
                  <label>
                    Status
                    <select className="thera-input" value={selected.status} onChange={(event) => patchSelected({ status: event.target.value as SpecialtyProgramStatus })}>
                      {statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                    </select>
                  </label>
                  <label>
                    Version
                    <input className="thera-input" type="number" min={1} value={selected.version} onChange={(event) => patchSelected({ version: Number(event.target.value) || 1 })} />
                  </label>
                  <label>
                    Effective from
                    <input className="thera-input" type="date" value={selected.effectiveFrom} onChange={(event) => patchSelected({ effectiveFrom: event.target.value })} />
                  </label>
                  <label>
                    Effective to
                    <input className="thera-input" type="date" value={selected.effectiveTo} onChange={(event) => patchSelected({ effectiveTo: event.target.value })} />
                  </label>
                  <label style={{ gridColumn: "1 / -1" }}>
                    Description
                    <textarea className="thera-input" value={selected.description} onChange={(event) => patchSelected({ description: event.target.value })} />
                  </label>
                </div>
                <button type="button" className="thera-action" style={{ marginTop: 10 }} disabled={saving || !selected.name.trim()} onClick={() => void saveTemplate()}>
                  Save Template
                </button>
              </section>

              <section className="thera-card">
                <div className="thera-card-header">
                  <div>
                    <div className="thera-eyebrow">PROGRAM REQUIREMENTS</div>
                    <h2>Configurable Elements</h2>
                    <p>These rows define what the practice wants this program to track. Nothing here blocks clinical note signing.</p>
                  </div>
                </div>

                <div className="thera-table-wrap">
                  <table className="thera-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Label / details</th>
                        <th>Required</th>
                        <th>Order</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <select className="thera-input" value={item.itemType} onChange={(event) => patchItem(item.id, { itemType: event.target.value as SpecialtyProgramItemType })}>
                              {SPECIALTY_PROGRAM_ITEM_TYPES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                            </select>
                          </td>
                          <td>
                            <input className="thera-input" value={item.label} onChange={(event) => patchItem(item.id, { label: event.target.value })} />
                            <textarea className="thera-input" style={{ marginTop: 6 }} value={item.description} onChange={(event) => patchItem(item.id, { description: event.target.value })} />
                          </td>
                          <td>
                            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input type="checkbox" checked={item.isRequired} onChange={(event) => patchItem(item.id, { isRequired: event.target.checked })} />
                              Required
                            </label>
                          </td>
                          <td>
                            <input className="thera-input" type="number" min={0} value={item.sortOrder} onChange={(event) => patchItem(item.id, { sortOrder: Number(event.target.value) || 0 })} />
                          </td>
                          <td>
                            <div className="thera-filter-row" style={{ flexWrap: "wrap" }}>
                              <button type="button" className="thera-action secondary" disabled={saving || !item.label.trim()} onClick={() => void saveItem(item)}>Save</button>
                              <button type="button" className="thera-action secondary" disabled={saving} onClick={() => void removeItem(item)}>Remove</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 14, borderTop: "1px solid var(--thera-border)", paddingTop: 12 }}>
                  <div className="thera-field-label">Add requirement</div>
                  <div className="thera-form-grid" style={{ marginTop: 8 }}>
                    <label>
                      Type
                      <select className="thera-input" value={newItemType} onChange={(event) => setNewItemType(event.target.value as SpecialtyProgramItemType)}>
                        {SPECIALTY_PROGRAM_ITEM_TYPES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                      </select>
                    </label>
                    <label>
                      Label
                      <input className="thera-input" value={newItemLabel} onChange={(event) => setNewItemLabel(event.target.value)} placeholder={itemTypeLabel(newItemType)} />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>
                      Details
                      <textarea className="thera-input" value={newItemDescription} onChange={(event) => setNewItemDescription(event.target.value)} />
                    </label>
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="checkbox" checked={newItemRequired} onChange={(event) => setNewItemRequired(event.target.checked)} />
                      Required by this configured program
                    </label>
                  </div>
                  <button type="button" className="thera-action secondary" style={{ marginTop: 10 }} disabled={saving || !newItemLabel.trim()} onClick={() => void addItem()}>
                    + Add Requirement
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </>
  );
}
