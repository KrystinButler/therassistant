export type Icd10SearchResult = {
  code: string;
  name: string;
};

const ICD10_SEARCH_URL = "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search";

export async function searchIcd10(
  terms: string,
  signal?: AbortSignal,
): Promise<Icd10SearchResult[]> {
  const value = terms.trim();
  if (value.length < 2) return [];

  const url = new URL(ICD10_SEARCH_URL);
  url.searchParams.set("terms", value);
  url.searchParams.set("count", "15");
  url.searchParams.set("df", "code,name");
  url.searchParams.set("sf", "code,name");
  url.searchParams.set("cf", "code");

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new Error("ICD-10-CM reference search is temporarily unavailable.");
  }

  const payload = await response.json() as unknown;
  if (!Array.isArray(payload) || !Array.isArray(payload[3])) return [];

  return (payload[3] as unknown[])
    .map((row) => {
      if (!Array.isArray(row)) return null;
      const code = String(row[0] ?? "").trim().toUpperCase();
      const name = String(row[1] ?? "").trim();
      return code ? { code, name } : null;
    })
    .filter((row): row is Icd10SearchResult => Boolean(row));
}
