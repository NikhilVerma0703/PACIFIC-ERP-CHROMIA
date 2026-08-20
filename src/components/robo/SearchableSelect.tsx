"use client";
// Searchable dropdown used across the Robo entry form. Free-text search over a
// master list; when `onCreate` is provided and the query matches nothing
// exactly, the last row becomes an “Add …” action so the operator can extend
// the master list without leaving the form.
import { useEffect, useMemo, useRef, useState } from "react";

export interface SsOption { id: string; name: string; hint?: string }

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";

export function SearchableSelect({
  value, onSelect, options, placeholder = "Search…", onCreate, disabled = false,
}: {
  value: string;
  onSelect: (name: string) => void;
  options: SsOption[];
  placeholder?: string;
  /** POST the new name to its master API; throw to keep the dropdown open. */
  onCreate?: (name: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options),
    [options, q],
  );
  const exact = q !== "" && options.some((o) => o.name.toLowerCase() === q);

  if (value) {
    return (
      <div className="flex items-center gap-1.5">
        {/* On a tablet the grid drops to a ~120px cell and a name like
            BANYAN_23_DVCTH lost everything after the eighth character. Below md
            the value wraps instead of being clipped, at the same 16px the touch
            rule gives the search input beside it, on a box tall enough to hold
            two lines. From md up this is byte-for-byte the old chip: one line,
            truncated, 14px. `title` carries the full value in every case. */}
        <div className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm">
          <span
            title={value}
            className="block text-base break-words text-gray-900 md:truncate md:text-sm"
          >
            {value}
          </span>
        </div>
        {!disabled && (
          <button type="button" aria-label="Clear" onClick={() => { onSelect(""); setQuery(""); }}
            className="shrink-0 rounded-md px-1.5 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-red-500">✕</button>
        )}
      </div>
    );
  }

  const create = async () => {
    const name = query.trim();
    if (!onCreate || busy || !name) return;
    setBusy(true);
    try {
      await onCreate(name);
      onSelect(name);
      setQuery("");
      setOpen(false);
    } catch {
      /* parent surfaced the error; keep the dropdown open */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={inp}
        disabled={disabled}
        autoComplete="off"
      />
      {open && !disabled && (
        /* The panel was `w-full` — exactly the cell width — so every option was
           clipped to whatever the grid allowed, and on the machine grid that is
           ~120px. Below md it now sizes to its content (`w-max`), never
           narrower than the field and never wider than the viewport allows, so
           the whole value is readable and tappable. `md:w-full` restores the
           desktop panel exactly as it was. */
        <div className="absolute z-20 mt-1 max-h-72 w-max min-w-full max-w-[min(85vw,24rem)] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg md:max-h-52 md:w-full md:max-w-none">
          {filtered.map((o) => (
            <button key={o.id} type="button"
              onClick={() => { onSelect(o.name); setQuery(""); setOpen(false); }}
              className="flex w-full flex-col items-start gap-0.5 border-b border-gray-50 px-3 py-2 text-left transition last:border-0 hover:bg-brand/5 md:flex-row md:items-center md:gap-2">
              {/* The hint (a program's design) is `shrink-0`, so on a narrow
                  cell it took the whole row and squeezed the name to nothing.
                  Below md the two stack; from md up the row is unchanged. */}
              <span title={o.name} className="min-w-0 w-full text-sm break-words text-gray-800 md:w-auto md:flex-1 md:truncate">{o.name}</span>
              {o.hint && <span className="shrink-0 text-xs text-gray-400">{o.hint}</span>}
            </button>
          ))}
          {filtered.length === 0 && !(onCreate && q !== "") && (
            <div className="px-3 py-2 text-xs text-gray-400">{onCreate ? "Type to search or add new." : "No matches."}</div>
          )}
          {onCreate && q !== "" && !exact && (
            <button type="button" onClick={create} disabled={busy}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-brand transition hover:bg-brand/5 disabled:opacity-60">
              {busy ? "Adding…" : `+ Add “${query.trim()}”`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
