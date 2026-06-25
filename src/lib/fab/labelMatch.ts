// ============================================================
// lib/fab/labelMatch.ts
//
// Snap an OCR'd cut-plan panel label to the project's KNOWN label
// universe (every "<Dwg#>-<Piece>" coming from the Excel Drawing
// Summary, e.g. "1-2A" = drawing 1, piece 2A).
//
// The whole reliability of the cut-plan import rests here: because the
// set of valid labels is known and small, we never trust raw OCR. We
// correct each read to the nearest valid label, absorbing the usual
// OCR confusions (0/O, 1/I/l, 2/Z, 5/S, 8/B, 6/G ...). A panel's
// dimension is used as a tie-breaker when two labels are equally close.
//
// Pure module — no I/O, no deps. Unit-testable in isolation.
// ============================================================

export type LabelConfidence =
  | "exact"      // matched a valid label verbatim (after normalisation)
  | "corrected"  // small, unambiguous OCR fix (drawing-digit fold / dim-confirmed)
  | "fuzzy"      // nearest valid label within distance, clear winner
  | "ambiguous"  // several valid labels equally close — needs a human
  | "none";      // nothing close enough (or no label printed)

export interface LabelResult {
  raw: string;                 // exactly what OCR produced
  label: string | null;        // canonical valid label, or null
  confidence: LabelConfidence;
  distance: number;            // weighted edit distance to the chosen label
  candidates: string[];        // close contenders (for ambiguous / none)
}

export interface PieceDim { w: number; d: number } // inches (Excel Width × Depth)

export interface LabelMatchOptions {
  maxDistance?: number;                  // accept only if best ≤ this (default 1.6)
  minMargin?: number;                    // best must beat 2nd best by this (default 0.6)
  dim?: string | null;                   // OCR'd panel dim, e.g. "25.5x102"
  dimByLabel?: Map<string, PieceDim>;    // label → known piece dims, for tie-break
  dimTolerance?: number;                 // inches of slack for dim match (default 2)
}

// ---- OCR-confusable character classes -------------------------------------
const CONFUSABLES: string[][] = [
  ["0", "O", "Q", "D"],
  ["1", "I", "L", "|", "T"],
  ["2", "Z"],
  ["4", "A"],
  ["5", "S"],
  ["6", "G"],
  ["8", "B"],
  ["9", "Q"],
];
const CONFUSE = new Map<string, Set<string>>();
for (const grp of CONFUSABLES) {
  for (const c of grp) {
    const set = CONFUSE.get(c) ?? new Set<string>();
    for (const o of grp) if (o !== c) set.add(o);
    CONFUSE.set(c, set);
  }
}

function subCost(a: string, b: string): number {
  if (a === b) return 0;
  const A = a.toUpperCase();
  const B = b.toUpperCase();
  if (A === B) return 0.1;                       // case-only difference
  if (CONFUSE.get(A)?.has(B)) return 0.4;        // known OCR confusion
  return 1;
}

/** Weighted Levenshtein: confusable substitutions are cheap. */
function weightedLev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + subCost(a[i - 1], b[j - 1]),
      );
    }
  }
  return dp[m][n];
}

/** Canonical form: upper-case, unify dashes/underscores, drop whitespace. */
export function normalizeLabel(s: unknown): string {
  return String(s ?? "")
    .toUpperCase()
    .replace(/[‐-―−_]/g, "-") // ‐ ‑ ‒ – — ― − _  → hyphen
    .replace(/\s+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Build the project's valid label list from drawings + requirements. */
export function buildValidLabels(
  drawings: { drawingNumber: string; requirements: { pieceLabel: string | null }[] }[],
): string[] {
  const out = new Set<string>();
  for (const d of drawings) {
    for (const r of d.requirements) {
      if (r.pieceLabel != null && String(r.pieceLabel).trim() !== "") {
        out.add(`${d.drawingNumber}-${r.pieceLabel}`);
      }
    }
  }
  return [...out];
}

function parseDim(s: string | null | undefined): PieceDim | null {
  if (!s) return null;
  const m = String(s).replace(/[xX×*]/g, "x").match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return { w: parseFloat(m[1]), d: parseFloat(m[2]) };
}

/** Order-independent dimension match within tolerance (inches). */
function dimMatches(a: PieceDim | null, b: PieceDim | undefined, tol: number): boolean {
  if (!a || !b) return false;
  const near = (x: number, y: number) => Math.abs(x - y) <= tol;
  return (near(a.w, b.w) && near(a.d, b.d)) || (near(a.w, b.d) && near(a.d, b.w));
}

/**
 * Snap a raw OCR label to the nearest valid project label.
 * Returns label=null with confidence "ambiguous"/"none" when no confident
 * single match exists — the UI surfaces these for a quick human fix.
 */
export function snapLabel(raw: string, valid: string[], opts: LabelMatchOptions = {}): LabelResult {
  const maxD = opts.maxDistance ?? 1.6;
  const margin = opts.minMargin ?? 0.6;
  const tol = opts.dimTolerance ?? 2;

  const nraw = normalizeLabel(raw);
  if (!nraw || nraw === "-") {
    return { raw, label: null, confidence: "none", distance: Infinity, candidates: [] };
  }

  const idx = new Map<string, string>(); // normalized → original
  for (const v of valid) idx.set(normalizeLabel(v), v);

  // 1) exact (after normalisation)
  if (idx.has(nraw)) {
    return { raw, label: idx.get(nraw)!, confidence: "exact", distance: 0, candidates: [] };
  }

  // 2) rank all valid labels by weighted distance
  const scored = [...idx.entries()]
    .map(([nv, orig]) => ({ orig, d: weightedLev(nraw, nv) }))
    .sort((a, b) => a.d - b.d || a.orig.localeCompare(b.orig));

  const best = scored[0];
  if (!best || best.d > maxD) {
    return { raw, label: null, confidence: "none", distance: best?.d ?? Infinity, candidates: scored.slice(0, 3).map((s) => s.orig) };
  }

  const second = scored[1];
  const isTie = second && second.d - best.d < margin;

  if (isTie) {
    // 3) dimension tie-break: among the equally-close labels, keep the one
    //    whose known piece size matches the panel's OCR'd dimension.
    const dd = parseDim(opts.dim);
    if (dd && opts.dimByLabel) {
      const close = scored.filter((s) => s.d - best.d < margin);
      const byDim = close.filter((s) => dimMatches(dd, opts.dimByLabel!.get(s.orig), tol));
      if (byDim.length === 1) {
        return { raw, label: byDim[0].orig, confidence: "corrected", distance: best.d, candidates: close.map((c) => c.orig) };
      }
    }
    return {
      raw, label: null, confidence: "ambiguous", distance: best.d,
      candidates: scored.filter((s) => s.d - best.d < margin).slice(0, 4).map((s) => s.orig),
    };
  }

  return {
    raw, label: best.orig,
    confidence: best.d <= 0.5 ? "corrected" : "fuzzy",
    distance: best.d, candidates: [],
  };
}
