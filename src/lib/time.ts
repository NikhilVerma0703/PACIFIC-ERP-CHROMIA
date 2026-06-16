// Pure helpers for Airtable "duration" time-of-day fields, stored as the
// number of seconds past midnight. No server imports — safe in client bundles.

export function secondsToHHMM(v: unknown): string {
  if (v == null || v === "") return "";
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return "";
  const s = Math.round(n);
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Parse an "HH:MM" / "HH:MM:SS" time input back to seconds past midnight. */
export function hhmmToSeconds(raw: unknown): number | null {
  const str = String(raw ?? "").trim();
  if (!str) return null;
  const m = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) { const f = parseFloat(str); return Number.isFinite(f) ? f : null; }
  return (+m[1]) * 3600 + (+m[2]) * 60 + (m[3] ? +m[3] : 0);
}
