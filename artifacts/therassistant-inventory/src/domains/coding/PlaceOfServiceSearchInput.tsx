import { useEffect, useState } from "react";

import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";

type PosResult = { code: string; name: string; description: string };

type Props = {
  code: string;
  disabled?: boolean;
  onSelect: (result: PosResult) => void;
};

async function searchPos(search: string, signal?: AbortSignal): Promise<PosResult[]> {
  const response = await authenticatedFetch(
    new URL(`${SUPABASE_URL}/rest/v1/rpc/search_place_of_service_codes`),
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_search: search, p_limit: 30 }),
    },
  );
  if (!response.ok) throw new Error("Place-of-service reference search failed.");
  const rows = await response.json() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
  }));
}

export function PlaceOfServiceSearchInput({ code, disabled = false, onSelect }: Props) {
  const [query, setQuery] = useState(code);
  const [results, setResults] = useState<PosResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => setQuery(code), [code]);

  function load(value: string) {
    const controller = new AbortController();
    void searchPos(value, controller.signal)
      .then((next) => {
        setResults(next);
        setOpen(next.length > 0);
      })
      .catch(() => {
        setResults([]);
        setOpen(false);
      });
  }

  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <input
        className="thera-input"
        value={query}
        disabled={disabled}
        placeholder="POS"
        autoComplete="off"
        onFocus={() => load(query.trim())}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          const value = event.target.value;
          setQuery(value);
          load(value.trim());
          if (/^\d{2}$/.test(value.trim())) {
            onSelect({ code: value.trim(), name: "", description: "" });
          }
        }}
      />
      {open && results.length ? (
        <div
          role="listbox"
          aria-label="Place of service search results"
          style={{
            position: "absolute",
            zIndex: 30,
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: 300,
            maxWidth: 440,
            maxHeight: 280,
            overflowY: "auto",
            border: "1px solid var(--thera-border)",
            borderRadius: 8,
            background: "#fff",
            boxShadow: "0 12px 28px rgba(27,59,96,.14)",
          }}
        >
          {results.map((result) => (
            <button
              key={result.code}
              type="button"
              role="option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect(result);
                setQuery(result.code);
                setOpen(false);
              }}
              style={{
                display: "grid",
                gap: 2,
                width: "100%",
                padding: "9px 10px",
                border: 0,
                borderBottom: "1px solid #edf1f4",
                background: "#fff",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <strong>{result.code} — {result.name}</strong>
              {result.description ? <span className="thera-table-subtext">{result.description}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
