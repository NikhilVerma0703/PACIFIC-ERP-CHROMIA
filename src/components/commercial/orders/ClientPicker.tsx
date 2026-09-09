"use client";
// The client search box, shared by the new-order form and the workspace's
// Overview tab (which can correct a client picked in error).
//
// It reads GET /api/office/commercial/clients?q= — the clients builder's list
// endpoint, which returns { items, total, page, limit }. Until that route
// exists the box reports the failure inline and the rest of the form still
// works; it never throws and never silently shows an empty list, because
// "no clients match" and "the client list could not be read" must not look
// the same to somebody about to raise an order.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/readJson";
import type { ClientExtLike } from "@/lib/commercial/orders-rules";
import { INPUT } from "./fields";

export interface ClientRow {
  id: string;
  name: string;
  country?: string | null;
  city?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  defaultCurrency?: string | null;
  defaultPaymentTerms?: string | null;
  defaultDeliveryTerms?: string | null;
  defaultPortOfDischarge?: string | null;
  commercialExt?: ClientExtLike | null;
}

interface ClientsPage { items: ClientRow[]; total: number }

export function ClientPicker({ onPick, placeholder = "Type a client name…", autoFocus = false }: {
  onPick: (c: ClientRow) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = query.trim();
    timer.current = setTimeout(async () => {
      setSearching(true);
      const u = new URLSearchParams({ limit: "20" });
      if (term) u.set("q", term);
      const r = await fetch(`/api/office/commercial/clients?${u.toString()}`, { cache: "no-store" });
      const res = await readJson<ClientsPage>(r);
      setSearching(false);
      if (!res.ok || !res.data) { setError(res.error ?? "Could not read the client list."); setResults([]); return; }
      setError(null);
      setResults(Array.isArray(res.data.items) ? res.data.items : []);
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  return (
    <div>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <input className={INPUT} value={query} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => setQuery(e.target.value)} />
      {searching && <p className="mt-1 text-xs text-gray-400">Searching…</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {results.length > 0 && (
        <ul className="mt-2 max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => onPick(c)}>
                <span className="font-medium text-gray-900">{c.name}</span>
                <span className="ml-2 text-xs text-gray-400">{[c.city, c.country].filter(Boolean).join(", ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!searching && !error && results.length === 0 && query.trim() !== "" && (
        <p className="mt-1 text-xs text-gray-400">
          No client matches. <Link href="/office/commercial/clients" className="text-brand hover:underline">Add one</Link>.
        </p>
      )}
    </div>
  );
}
