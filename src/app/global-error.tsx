"use client";
// Global error screen. The most common cause in production is a STALE BUILD:
// an open tab from a previous deploy tries to lazy-load a chunk that no longer
// exists. That case self-heals with one automatic reload (loop-guarded);
// anything else gets a clean branded screen with a reload button.
import { useEffect } from "react";

const CHUNK_RE = /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|css chunk/i;

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (!CHUNK_RE.test(error?.message ?? "")) return;
    const last = Number(sessionStorage.getItem("chunk-reload-at") ?? 0);
    if (Date.now() - last > 30_000) {
      sessionStorage.setItem("chunk-reload-at", String(Date.now()));
      window.location.reload();
    }
  }, [error]);

  return (
    <html>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>⚙️</div>
          <h1 style={{ fontSize: 18, color: "#0f172a", margin: 0 }}>The app was updated — reloading the new version…</h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>If this screen stays, tap Reload.</p>
          <button
            onClick={() => { sessionStorage.removeItem("chunk-reload-at"); window.location.reload(); }}
            style={{ background: "#0f4c5c", color: "#fff", border: 0, borderRadius: 10, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
