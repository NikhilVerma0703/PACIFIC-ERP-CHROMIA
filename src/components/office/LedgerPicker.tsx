"use client";
// The ledger picker, in its own module so BOTH review panels share one
// implementation without importing each other. FinanceBills <-> VendorInvoicePanel
// would be a cycle, and a cycle here leaves one of the two components undefined
// at module-init time depending on which side the bundler evaluates first.
import { useCallback, useEffect, useRef, useState } from "react";

const API = "/api/office/finance";
const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  return r.json() as Promise<T>;
}

/** Debounced server-driven ledger search — the master list is too large to ship
 * to the browser, and with no query the engine already returns this person's
 * own claim history, which is usually the answer. */
// Exported so the vendor-invoice panel uses the SAME picker: same debounce,
// same "what this person used before" fallback, same clear-to-change affordance.
// A second, subtly different picker on the neighbouring tab is how two screens
// drift apart.
export function LedgerPicker({ value, person, onSelect }: { value: string; person: string; onSelect: (l: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<{ name: string; hint?: string }[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const search = useCallback((q: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const url = q.trim()
          ? `${API}/ledgers?q=${encodeURIComponent(q.trim())}&limit=25`
          : `${API}/ledgers?person=${encodeURIComponent(person)}&limit=25`;
        const d = await j<{ ledgers: string[]; source?: string }>(url);
        setOptions(d.ledgers.map((name) => ({ name, hint: q.trim() ? undefined : d.source })));
      } catch { setOptions([]); }
    }, 220);
  }, [person]);

  if (value) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm">
          <span className="block truncate text-sm text-gray-900">{value}</span>
        </div>
        <button type="button" aria-label="Change ledger" onClick={() => { onSelect(""); setQuery(""); setOptions([]); }}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-red-500">Change</button>
      </div>
    );
  }
  return (
    <div ref={ref} className="relative">
      <input value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); search(e.target.value); }}
        onFocus={() => { setOpen(true); search(query); }}
        placeholder="Search expense ledgers…" className={inp} autoComplete="off" />
      {open && (
        <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">Type to search the ledger master.</div>
          ) : options.map((o) => (
            <button key={o.name} type="button" onClick={() => { onSelect(o.name); setOpen(false); }}
              className="flex w-full items-center gap-2 border-b border-gray-50 px-3 py-2 text-left transition last:border-0 hover:bg-brand/5">
              <span className="flex-1 truncate text-sm text-gray-800">{o.name}</span>
              {o.hint && <span className="shrink-0 text-xs text-gray-400">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
