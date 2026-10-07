import { useEffect, useState } from "react";

import { getEncounterServiceFee } from "../encounters/repository";
import {
  procedureCodeReferenceSummary,
  searchProcedureCodes,
  type ProcedureCodeSearchResult,
} from "./procedure-codes";

type Props = {
  code: string;
  disabled?: boolean;
  serviceDate?: string;
  onSelect: (result: ProcedureCodeSearchResult) => void;
};

function currentEncounterId() {
  if (typeof window === "undefined") return "";
  const match = window.location.pathname.match(/^\/encounters\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function populateEncounterCharge(code: string, serviceDate?: string, replaceExisting = false) {
  if (typeof document === "undefined") return;
  const encounterId = currentEncounterId();
  const chargeInput = document.getElementById("encounter-charge-amount");
  if (!encounterId || !(chargeInput instanceof HTMLInputElement)) return;
  if (!replaceExisting && chargeInput.value.trim()) return;

  try {
    const fee = await getEncounterServiceFee(encounterId, code, "", serviceDate);
    if (!fee) return;
    setControlledInputValue(chargeInput, (fee.rateCents / 100).toFixed(2));
  } catch {
    // A missing/unavailable fee leaves the charge editable for manual entry.
  }
}

export function ProcedureCodeSearchInput({ code, disabled = false, serviceDate, onSelect }: Props) {
  const [query, setQuery] = useState(code);
  const [results, setResults] = useState<ProcedureCodeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedReference, setSelectedReference] = useState<ProcedureCodeSearchResult | null>(null);
  const [referenceChecked, setReferenceChecked] = useState(false);

  useEffect(() => {
    setQuery(code);
  }, [code]);

  useEffect(() => {
    const exactCode = code.trim().toUpperCase();
    if (/^[A-Z0-9]{4,5}$/.test(exactCode)) {
      void populateEncounterCharge(exactCode, serviceDate, false);
    }
  }, [code, serviceDate]);

  useEffect(() => {
    const exactCode = code.trim().toUpperCase();
    if (exactCode.length < 4) {
      setSelectedReference(null);
      setReferenceChecked(false);
      return;
    }

    const controller = new AbortController();
    setReferenceChecked(false);
    searchProcedureCodes(exactCode, serviceDate, controller.signal)
      .then((next) => {
        setSelectedReference(
          next.find((result) => result.code.toUpperCase() === exactCode) ?? null,
        );
        setReferenceChecked(true);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          setSelectedReference(null);
          setReferenceChecked(true);
        }
      });

    return () => controller.abort();
  }, [code, serviceDate]);

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
      searchProcedureCodes(value, serviceDate, controller.signal)
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
  }, [query, code, serviceDate]);

  function choose(result: ProcedureCodeSearchResult) {
    onSelect(result);
    void populateEncounterCharge(result.code, serviceDate, true);
    setSelectedReference(result);
    setReferenceChecked(true);
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
            const selected = {
              code: value.trim(),
              name: "",
              system: "",
              version: "",
              effectiveFrom: "",
              effectiveTo: "",
              descriptionSource: "",
            };
            onSelect(selected);
            void populateEncounterCharge(selected.code, serviceDate, true);
          }
        }}
      />
      {searching ? <div className="thera-table-subtext" style={{ marginTop: 4 }}>Searching code library…</div> : null}
      {query.trim().length >= 2 && query.trim() !== code ? (
        <div className="thera-table-subtext" style={{ marginTop: 4 }}>
          Date-of-service filtering is active. Results reflect only reference releases currently loaded in THERASSISTANT; no match is not an invalid-code determination.
        </div>
      ) : null}
      {query.trim() === code.trim() && selectedReference ? (
        <div className="thera-table-subtext" style={{ marginTop: 4 }}>
          {procedureCodeReferenceSummary(selectedReference, serviceDate)}
        </div>
      ) : null}
      {query.trim() === code.trim() && code.trim() && referenceChecked && !selectedReference ? (
        <div className="thera-table-subtext" style={{ marginTop: 4 }}>
          This code was not found in the currently loaded reference data{serviceDate ? ` for DOS ${serviceDate}` : ""}. Verify the current official or payer source before relying on it; this does not mean the code is invalid.
        </div>
      ) : null}
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
              <span className="thera-table-subtext">{procedureCodeReferenceSummary(result, serviceDate)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
