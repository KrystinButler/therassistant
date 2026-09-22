import { useEffect, useState } from "react";

import { searchIcd10, type Icd10SearchResult } from "./icd10";

type Props = {
  code: string;
  description: string;
  disabled?: boolean;
  serviceDate?: string;
  onSelect: (result: Icd10SearchResult) => void;
};

export function Icd10SearchInput({
  code,
  description,
  disabled = false,
  serviceDate,
  onSelect,
}: Props) {
  const [query, setQuery] = useState(code);
  const [results, setResults] = useState<Icd10SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!code) return;
    setQuery(description ? `${code} — ${description}` : code);
  }, [code, description]);

  useEffect(() => {
    const raw = query.trim();
    if (raw.length < 2 || (description && raw === `${code} — ${description}`)) {
      setResults([]);
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchIcd10(raw, serviceDate, controller.signal)
        .then((next) => {
          setResults(next);
          setOpen(next.length > 0);
        })
        .catch((error) => {
          if ((error as Error).name !== "AbortError") {
            setResults([]);
            setOpen(false);
          }
        })
        .finally(() => setSearching(false));
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, code, description, serviceDate]);

  function choose(result: Icd10SearchResult) {
    onSelect(result);
    setQuery(`${result.code} — ${result.name}`);
    setResults([]);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <input
        className="thera-input"
        value={query}
        disabled={disabled}
        placeholder="Search ICD-10-CM code or diagnosis"
        autoComplete="off"
        onFocus={() => setOpen(results.length > 0)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          const value = event.target.value;
          setQuery(value);
          const manualCode = value.trim().toUpperCase();
          if (/^[A-Z][0-9A-Z]{2}(?:\.[0-9A-Z]{1,4})?$/.test(manualCode)) {
            onSelect({ code: manualCode, name: "" });
          }
        }}
      />
      {searching ? (
        <div className="thera-table-subtext" style={{ marginTop: 4 }}>
          Searching ICD-10-CM…
        </div>
      ) : null}
      {open && results.length ? (
        <div
          role="listbox"
          aria-label="ICD-10-CM search results"
          style={{
            position: "absolute",
            zIndex: 30,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
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
              onClick={() => choose(result)}
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
              <strong>{result.code}</strong>
              <span className="thera-table-subtext">{result.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
