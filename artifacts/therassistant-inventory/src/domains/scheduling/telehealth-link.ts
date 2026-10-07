export function safeTelehealthUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try { const url = new URL(value.trim()); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
