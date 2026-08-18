"use client";

// Shared slab-picker data source for the three supervisor screens that assign a
// physical QC slab (Cut Queue, Planning Board, project allocation view).
//
// WHY THIS EXISTS. All three used to take the whole QC history as a prop —
// /api/fab/slabs returned 43,618 rows / ~8.4 MB with no cap — fetched once by
// the parent when the PAGE loaded, then filtered in the browser as the user
// typed. Three separate consequences, all of which read to the operator as "the
// inventory isn't loading":
//
//   1. 8.4 MB is over Vercel's 4.5 MB serverless response cap, so the request
//      failed as a platform error rather than returning slabs at all;
//   2. every visit to /fab/supervisor paid that download before rendering
//      anything, because the parent fetched it up front whether or not anyone
//      opened a picker;
//   3. the one screen that had a client-side .slice(0, 200) guard showed the 200
//      LOWEST slab numbers — the oldest stock in the factory — and labelled it
//      "(200)", so the truncation was invisible.
//
// Searching server-side fixes all three: nothing is fetched until a picker is
// opened, and the wire only ever carries one screenful.

import { useEffect, useState } from "react";
import { getJson } from "./postJson";
import { QC_SLAB_PAGE, qcSlabsUrl } from "./qcSlabQuery";

export { QC_SLAB_PAGE, qcSlabsUrl };

export interface QcSlab {
  pacificQcId:  string;
  slabCode:     string;
  colour:       string | null;
  thicknessMm:  number | null;
  qualityGrade: string | null;
  batchKey:     string | null;
}

/**
 * Loads the slab list for one picker. Fetches nothing until `open` — the picker
 * is a dropdown on a page that usually gets closed again without being used.
 */
export function useQcSlabs(open: boolean, thicknessMm: number | null) {
  const [search,  setSearch]  = useState("");
  const [slabs,   setSlabs]   = useState<QcSlab[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function run() {
      setLoading(true);
      const r = await getJson<QcSlab>(qcSlabsUrl(search, thicknessMm));
      // The picker can be closed, or the term changed again, while this is in
      // flight; a late reply must not overwrite a newer one.
      if (cancelled) return;
      setSlabs(r.data);
      setError(r.error);
      setLoading(false);
    }

    // Typing is debounced; opening the picker is not — the first list should be
    // on screen by the time the operator has focused the search box.
    const t = setTimeout(run, search ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, search, thicknessMm]);

  return {
    search, setSearch, slabs, loading, error,
    /** A full page back means there are almost certainly more behind it. */
    capped: slabs.length >= QC_SLAB_PAGE,
  };
}
