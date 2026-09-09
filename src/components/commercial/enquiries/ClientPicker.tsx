"use client";
// Picking the customer an enquiry is from.
//
// It searches this module's own /api/office/commercial/clients (name, e-mail
// or customer code, active only), because that is the list a Commercial user
// is allowed to see and the one an order will be raised against. An enquiry
// with nobody on the master is normal — that is what the prospect fields are
// for — so "not found" offers the customers page rather than blocking.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/readJson";

export interface PickedClient {
  id: string;
  name: string;
  country?: string | null;
  city?: string | null;
  commercialExt?: { customerCode?: string | null } | null;
}

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";

export function ClientPicker({ value, onChange, disabled = false }: {
  value: PickedClient | null;
  onChange: (c: PickedClient | null) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedClient[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  // Debounced so a typist does not fire a query per keystroke at Neon.
  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults([]); setError(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      setBusy(true);
      const r = await fetch(`/api/office/commercial/clients?q=${encodeURIComponent(term)}&limit=10`, { cache: "no-store" });
      const res = await readJson<{ items: PickedClient[] }>(r);
      if (!alive) return;
      setBusy(false);
      if (!res.ok || !res.data) { setError(res.error ?? "Could not search the customer master"); setResults([]); return; }
      setError(null);
      setResults(res.data.items);
      setOpen(true);
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  // Click outside closes the list.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (value) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <span className="text-sm font-medium text-gray-900">{value.name}</span>
        <span className="text-xs text-gray-500">
          {[value.commercialExt?.customerCode, value.city, value.country].filter(Boolean).join(" · ")}
        </span>
        <Link href={`/office/commercial/clients/${value.id}`} className="text-xs text-brand hover:underline">open</Link>
        {!disabled && (
          <button type="button" className="ml-auto text-xs text-gray-500 hover:text-red-600" onClick={() => { onChange(null); setQ(""); }}>
            change
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={box}>
      <input
        className={inp}
        value={q}
        disabled={disabled}
        placeholder="Search the customer master by name, e-mail or code"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true); }}
      />
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      {open && q.trim() !== "" && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {busy && <div className="px-3 py-2 text-sm text-gray-500">Searching…</div>}
          {!busy && results.length === 0 && (
            <div className="px-3 py-3 text-sm text-gray-500">
              No customer matches. Leave this blank and fill the prospect&apos;s details below, or{" "}
              <Link href="/office/commercial/clients" className="text-brand hover:underline">add the customer</Link> first.
            </div>
          )}
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
              onClick={() => { onChange(c); setOpen(false); setQ(""); }}
            >
              <span className="font-medium text-gray-900">{c.name}</span>
              <span className="ml-2 text-xs text-gray-500">
                {[c.commercialExt?.customerCode, c.city, c.country].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
