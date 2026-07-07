"use client";
// Global error screen. Two cases:
//  - STALE BUILD: an open tab from a previous deploy fails to lazy-load a
//    chunk. Self-heals with one automatic reload (loop-guarded).
//  - ANYTHING ELSE (network drop, failed submit, runtime bug): say so
//    honestly — do NOT claim "the app was updated".
import { useEffect } from "react";

const CHUNK_RE = /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|css chunk/i;
const ss = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k: string) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const stale = CHUNK_RE.test(`${error?.name ?? ""} ${error?.message ?? ""}`);
  useEffect(() => {
    if (!stale) return;
    const last = Number(ss.get("chunk-reload-at") ?? 0);
    if (Date.now() - last > 30_000) {
      ss.set("chunk-reload-at", String(Date.now()));
      window.location.reload();
    }
  }, [stale]);

  return (
    <html>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>{stale ? "⚙️" : "⚠️"}</div>
          <h1 style={{ fontSize: 18, color: "#0f172a", margin: 0 }}>
            {stale ? "The app was updated — reloading the new version…" : "Something went wrong"}
          </h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: 0, maxWidth: 420 }}>
            {stale
              ? "If this screen stays, tap Reload."
              : "Your last action may not have been saved — after reloading, please check and re-enter it if it's missing."}
          </p>
          <button
            onClick={() => { ss.del("chunk-reload-at"); window.location.reload(); }}
            style={{ background: "#0f4c5c", color: "#fff", border: 0, borderRadius: 10, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Reload
          </button>
          {error?.digest ? <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>Error ref: {error.digest}</p> : null}
        </div>
      </body>
    </html>
  );
}
