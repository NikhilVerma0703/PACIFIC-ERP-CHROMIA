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
        <div className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm">
          <span className="block truncate text-sm text-gray-900">{value}</span>
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
        <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {filtered.map((o) => (
            <button key={o.id} type="button"
              onClick={() => { onSelect(o.name); setQuery(""); setOpen(false); }}
              className="flex w-full items-center gap-2 border-b border-gray-50 px-3 py-2 text-left transition last:border-0 hover:bg-brand/5">
              <span className="flex-1 truncate text-sm text-gray-800">{o.name}</span>
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
