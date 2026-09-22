import { useEffect, useState } from "react";

import { searchProcedureCodes, type ProcedureCodeSearchResult } from "./procedure-codes";

type Props = {
  code: string;
  disabled?: boolean;
  onSelect: (result: ProcedureCodeSearchResult) => void;
};

export function ProcedureCodeSearchInput({ code, disabled = false, onSelect }: Props) {
  const [query, setQuery] = useState(code);
  const [results, setResults] = useState<ProcedureCodeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(code);
  }, [code]);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2 || value === code) {
      setResults([]);
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchProcedureCodes(value, controller.signal)
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
    }, 225);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, code]);

  function choose(result: ProcedureCodeSearchResult) {
    onSelect(result);
    setQuery(result.code);
    setResults([]);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <input
        className="thera-input"
        value={query}
        disabled={disabled}
        placeholder="Search CPT / HCPCS"
        autoComplete="off"
        onFocus={() => setOpen(results.length > 0)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          const value = event.target.value.toUpperCase();
          setQuery(value);
          if (/^[A-Z0-9]{4,5}$/.test(value.trim())) {
            onSelect({ code: value.trim(), name: "", system: "", descriptionSource: "" });
          }
        }}
      />
      {searching ? <div className="thera-table-subtext" style={{ marginTop: 4 }}>Searching code library…</div> : null}
      {open && results.length ? (
        <div
          role="listbox"
          aria-label="Procedure code search results"
          style={{
            position: "absolute",
            zIndex: 30,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 300,
            overflowY: "auto",
            border: "1px solid var(--thera-border)",
            borderRadius: 8,
            background: "#fff",
            boxShadow: "0 12px 28px rgba(27,59,96,.14)",
          }}
        >
          {results.map((result) => (
            <button
              key={`${result.system}:${result.code}`}
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
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{result.code}</strong>
                <small>{result.system}</small>
              </span>
              <span className="thera-table-subtext">{result.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
