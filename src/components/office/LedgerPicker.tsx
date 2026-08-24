"use client";
// The ledger picker, in its own module so BOTH review panels share one
// implementation without importing each other. FinanceBills <-> VendorInvoicePanel
// would be a cycle, and a cycle here leaves one of the two components undefined
// at module-init time depending on which side the bundler evaluates first.
import { useCallback, useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/readJson";

const API = "/api/office/finance";
const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  // readJson on the success path: an expired session answers a JSON route with
  // the login page's HTML and status 200, which r.json() reported as
  // "Unexpected token '<'"; now it says what happened. Same result otherwise.
  const res = await readJson<T>(r);
  if (!res.ok) throw new Error(res.error ?? `Request failed (${r.status})`);
  return res.data as T;
}

/**
 * Which of the two fields this picker is. Both draw on the SAME master; `kind`
 * only decides the order and what the field opens on, server-side. See
 * apiShapes.ledgerOptions - neither kind can make a ledger unreachable.
 */
export type LedgerKind = "ledger" | "expense";

/**
 * Add a ledger to the master and resolve with the name it actually got.
 *
 * Lives here so all five fields create ledgers the same way. The server may
 * answer with a DIFFERENT spelling than the one typed - if the master already
 * holds a case or whitespace variant, that variant wins, because fin_ledger's
 * primary key is the name and a second spelling is a second ledger in Tally.
 * Callers must select what comes back, not what they sent.
 */
export async function createLedger(name: string, kind: LedgerKind): Promise<string> {
  const r = await fetch(`${API}/ledgers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim(), kind }),
    cache: "no-store",
  });
  const d = await r.json().catch(() => ({})) as { name?: string; error?: string };
  if (!r.ok) throw new Error(d.error || `Could not create that ledger (${r.status})`);
  return (d.name || name).trim();
}

/** Debounced server-driven ledger search — the master list is too large to ship
 * to the browser, and with no query the engine already returns this person's
 * own claim history, which is usually the answer. */
// Exported so the vendor-invoice panel uses the SAME picker: same debounce,
// same "what this person used before" fallback, same clear-to-change affordance.
// A second, subtly different picker on the neighbouring tab is how two screens
// drift apart.
//
// It is now BOTH ledger fields in both flows, not just the expense one. The
// alternative was SearchableSelect, which fetches every name once and filters
// in the browser: fine for a Robo tool list, wrong for 2,500+ ledgers, and its
// own header says so. Whatever is not fetched there is unreachable rather than
// merely on "page 2".
export function LedgerPicker({
  value, person, onSelect, kind = "expense", onCreate,
}: {
  value: string;
  person: string;
  onSelect: (l: string) => void;
  kind?: LedgerKind;
  /** POST the new name to the master, then resolve. Omit to hide the "create"
   *  row entirely - the house convention SearchableSelect documents. Reject to
   *  keep the dropdown open with the message shown. */
  onCreate?: (name: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<{ name: string; hint?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
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
        // `kind` rides on both branches: it is what makes one endpoint serve
        // two fields, and dropping it from the no-query branch would open the
        // Ledger field on expense heads.
        const url = q.trim()
          ? `${API}/ledgers?q=${encodeURIComponent(q.trim())}&kind=${kind}&limit=25`
          : `${API}/ledgers?person=${encodeURIComponent(person)}&kind=${kind}&limit=25`;
        const d = await j<{ ledgers: string[]; source?: string }>(url);
        setOptions(d.ledgers.map((name) => ({ name, hint: q.trim() ? undefined : d.source })));
      } catch { setOptions([]); }
    }, 220);
  }, [person, kind]);

  if (value) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm">
          <span className="block truncate text-sm text-gray-900">{value}</span>
        </div>
        <button type="button" aria-label="Change ledger" onClick={() => { onSelect(""); setQuery(""); setOptions([]); setErr(""); }}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-red-500">Change</button>
      </div>
    );
  }

  const typed = query.trim();
  // An exact hit is not a create. The comparison is case-insensitive because
  // the server refuses a case variant anyway - offering "+ Create" for one
  // would promise something that cannot happen.
  const exact = typed !== "" && options.some((o) => o.name.toLowerCase() === typed.toLowerCase());
  const canCreate = Boolean(onCreate) && typed !== "" && !exact;

  const create = async () => {
    if (!onCreate || busy || !typed) return;
    setBusy(true); setErr("");
    try {
      // The parent selects whatever the master actually accepted, so this does
      // NOT call onSelect(typed) - the two can differ.
      await onCreate(typed);
      setQuery(""); setOptions([]); setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div ref={ref} className="relative">
      <input value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setErr(""); search(e.target.value); }}
        onFocus={() => { setOpen(true); search(query); }}
        placeholder={kind === "ledger" ? "Search all ledgers…" : "Search expense ledgers…"}
        className={inp} autoComplete="off" />
      {open && (
        <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {options.length === 0 && !canCreate && (
            <div className="px-3 py-2 text-xs text-gray-400">
              {onCreate ? "Type to search the ledger master, or add a new one." : "Type to search the ledger master."}
            </div>
          )}
          {options.map((o) => (
            <button key={o.name} type="button" onClick={() => { onSelect(o.name); setOpen(false); }}
              className="flex w-full items-center gap-2 border-b border-gray-50 px-3 py-2 text-left transition last:border-0 hover:bg-brand/5">
              <span className="flex-1 truncate text-sm text-gray-800">{o.name}</span>
              {o.hint && <span className="shrink-0 text-xs text-gray-400">{o.hint}</span>}
            </button>
          ))}
          {canCreate && (
            <button type="button" onClick={create} disabled={busy}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-brand transition hover:bg-brand/5 disabled:opacity-60">
              {busy ? "Adding…" : `+ Add “${typed}” to the ledger master`}
            </button>
          )}
          {err && <div className="border-t border-gray-100 px-3 py-2 text-xs text-red-600">{err}</div>}
        </div>
      )}
    </div>
  );
}
