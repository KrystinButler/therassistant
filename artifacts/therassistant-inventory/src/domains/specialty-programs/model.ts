import type { Row } from "../../lib/tenant-data-client";

export type SpecialtyProgramStatus = "draft" | "active" | "inactive" | "archived";

export type SpecialtyProgramItemType =
  | "documentation_requirement"
  | "assessment"
  | "progress_measure"
  | "reporting_requirement"
  | "milestone"
  | "form";

export const SPECIALTY_PROGRAM_ITEM_TYPES: Array<{
  id: SpecialtyProgramItemType;
  label: string;
}> = [
  { id: "documentation_requirement", label: "Documentation requirement" },
  { id: "assessment", label: "Assessment" },
  { id: "progress_measure", label: "Progress measure" },
  { id: "reporting_requirement", label: "Reporting requirement" },
  { id: "milestone", label: "Milestone" },
  { id: "form", label: "Form" },
];

export type SpecialtyProgramTemplateItem = {
  id: string;
  templateId: string;
  itemType: SpecialtyProgramItemType;
  itemKey: string;
  label: string;
  description: string;
  isRequired: boolean;
  sortOrder: number;
  config: Row;
};

export type SpecialtyProgramTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  status: SpecialtyProgramStatus;
  version: number;
  effectiveFrom: string;
  effectiveTo: string;
  settings: Row;
  items: SpecialtyProgramTemplateItem[];
};

const statuses = new Set<SpecialtyProgramStatus>(["draft", "active", "inactive", "archived"]);
const itemTypes = new Set<SpecialtyProgramItemType>(SPECIALTY_PROGRAM_ITEM_TYPES.map((item) => item.id));

function objectValue(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

export function normalizeProgramCategory(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "custom";
}

export function itemTypeLabel(value: SpecialtyProgramItemType) {
  return SPECIALTY_PROGRAM_ITEM_TYPES.find((item) => item.id === value)?.label ?? value.replaceAll("_", " ");
}

export function mapSpecialtyProgramItem(row: Row): SpecialtyProgramTemplateItem {
  const rawType = String(row.item_type ?? "") as SpecialtyProgramItemType;
  return {
    id: String(row.id ?? ""),
    templateId: String(row.template_id ?? ""),
    itemType: itemTypes.has(rawType) ? rawType : "documentation_requirement",
    itemKey: String(row.item_key ?? ""),
    label: String(row.label ?? ""),
    description: String(row.description ?? ""),
    isRequired: row.is_required === true,
    sortOrder: Number(row.sort_order ?? 0) || 0,
    config: objectValue(row.config),
  };
}

export function mapSpecialtyProgramTemplate(
  row: Row,
  items: SpecialtyProgramTemplateItem[] = [],
): SpecialtyProgramTemplate {
  const rawStatus = String(row.status ?? "") as SpecialtyProgramStatus;
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    category: String(row.category ?? ""),
    description: String(row.description ?? ""),
    status: statuses.has(rawStatus) ? rawStatus : "draft",
    version: Number(row.version ?? 1) || 1,
    effectiveFrom: String(row.effective_from ?? ""),
    effectiveTo: String(row.effective_to ?? ""),
    settings: objectValue(row.settings),
    items,
  };
}
