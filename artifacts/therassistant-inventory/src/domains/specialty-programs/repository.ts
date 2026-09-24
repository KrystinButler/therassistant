import {
  tenantDelete,
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  type Row,
} from "../../lib/tenant-data-client";
import {
  mapSpecialtyProgramItem,
  mapSpecialtyProgramTemplate,
  normalizeProgramCategory,
  type SpecialtyProgramItemType,
  type SpecialtyProgramStatus,
  type SpecialtyProgramTemplate,
  type SpecialtyProgramTemplateItem,
} from "./model";

type DataRow = Row & { id: string };

export async function getSpecialtyProgramTemplates(): Promise<SpecialtyProgramTemplate[]> {
  const [templateRows, itemRows] = await Promise.all([
    tenantSelect<DataRow>("specialty_program_templates", { order: "name.asc" }),
    tenantSelect<DataRow>("specialty_program_template_items", { order: "sort_order.asc,label.asc" }),
  ]);
  const items = itemRows.map(mapSpecialtyProgramItem);
  return templateRows.map((row) =>
    mapSpecialtyProgramTemplate(
      row,
      items.filter((item) => item.templateId === row.id),
    )
  );
}

export async function createSpecialtyProgramTemplate(input: {
  name: string;
  category: string;
  description?: string;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("Program template name is required.");
  const row = await tenantInsert<DataRow>("specialty_program_templates", {
    name,
    category: normalizeProgramCategory(input.category || name),
    description: input.description?.trim() || null,
    status: "draft",
    version: 1,
    settings: {},
  });
  return mapSpecialtyProgramTemplate(row);
}

export async function updateSpecialtyProgramTemplate(
  id: string,
  values: {
    name: string;
    category: string;
    description: string;
    status: SpecialtyProgramStatus;
    version: number;
    effectiveFrom: string;
    effectiveTo: string;
  },
) {
  if (!values.name.trim()) throw new Error("Program template name is required.");
  const row = await tenantUpdate<DataRow>("specialty_program_templates", id, {
    name: values.name.trim(),
    category: normalizeProgramCategory(values.category || values.name),
    description: values.description.trim() || null,
    status: values.status,
    version: Math.max(1, Math.floor(values.version || 1)),
    effective_from: values.effectiveFrom || null,
    effective_to: values.effectiveTo || null,
  });
  return mapSpecialtyProgramTemplate(row);
}

export async function createSpecialtyProgramTemplateItem(input: {
  templateId: string;
  itemType: SpecialtyProgramItemType;
  label: string;
  description: string;
  isRequired: boolean;
  sortOrder: number;
}) {
  const label = input.label.trim();
  if (!label) throw new Error("Requirement label is required.");
  const keyBase = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "item";
  const row = await tenantInsert<DataRow>("specialty_program_template_items", {
    template_id: input.templateId,
    item_type: input.itemType,
    item_key: `${keyBase}_${crypto.randomUUID().slice(0, 8)}`,
    label,
    description: input.description.trim() || null,
    is_required: input.isRequired,
    sort_order: Math.max(0, Math.floor(input.sortOrder || 0)),
    config: {},
  });
  return mapSpecialtyProgramItem(row);
}

export async function updateSpecialtyProgramTemplateItem(
  id: string,
  values: SpecialtyProgramTemplateItem,
) {
  if (!values.label.trim()) throw new Error("Requirement label is required.");
  const row = await tenantUpdate<DataRow>("specialty_program_template_items", id, {
    item_type: values.itemType,
    label: values.label.trim(),
    description: values.description.trim() || null,
    is_required: values.isRequired,
    sort_order: Math.max(0, Math.floor(values.sortOrder || 0)),
    config: values.config,
  });
  return mapSpecialtyProgramItem(row);
}

export async function deleteSpecialtyProgramTemplateItem(id: string) {
  await tenantDelete("specialty_program_template_items", id);
}
