"use client";

import { useEffect, useState, type ReactNode } from "react";

// The desktop sidebar, collapsible from the logo tile — the mark IS the
// control. Hovering the Pacific tile swaps the logo for a chevron and says
// "Hide sidebar"; clicking slides the whole rail away. What remains is the
// same tile, floated to the top-left corner, which brings it back — the
// affordance to reopen is the exact mark used to close, so nothing new has
// to be discovered and nothing off-brand is added to the shell.
//
// Client state on a server shell: the nav and the user card stay
// server-rendered and arrive as children; this component only owns the
// width. The choice persists in localStorage, read AFTER mount — SSR always
// paints the rail expanded, and a one-frame correction on a hard reload
// beats a hydration mismatch. In-app navigation never re-mounts the shell,
// so the state simply survives it.
//
// The inner column keeps a fixed width while the <aside> animates, so the
// text clips behind the edge instead of rewrapping mid-slide. Mobile keeps
// its drawer (this is hidden below md), and print never shows the floating
// tile — a printed CEO report must not carry a stray logo button.

const KEY = "pacific-sidebar-hidden";

export function CollapsibleSidebar({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem(KEY) === "1") setHidden(true); } catch { /* private mode */ }
  }, []);
  const toggle = () => setHidden((h) => {
    const v = !h;
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ }
    return v;
  });

  return (
    <>
      {hidden && (
        <button
          type="button" onClick={toggle} title="Show sidebar" aria-label="Show sidebar"
          className="fixed left-3 top-3 z-40 hidden h-9 w-9 items-center justify-center rounded-xl bg-pacific-dark shadow-md transition-transform hover:scale-105 md:flex print:hidden"
        >
          <img src="/logo-white.png" alt="Pacific Surfaces" className="h-5 w-5 object-contain" />
        </button>
      )}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 overflow-hidden border-r bg-white/70 backdrop-blur transition-[width] duration-200 md:flex ${
          hidden ? "w-0 border-transparent" : "w-64 border-gray-200/70"
        }`}
      >
        <div className="flex h-full w-64 flex-col px-4 py-5">
          <div className="mb-6 flex shrink-0 items-center gap-2.5 px-2">
            <button
              type="button" onClick={toggle} title="Hide sidebar" aria-label="Hide sidebar" aria-expanded={!hidden}
              className="group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pacific-dark shadow-sm"
            >
              <img src="/logo-white.png" alt="Pacific Surfaces" className="h-5 w-5 object-contain transition-opacity group-hover:opacity-0" />
              <svg
                className="absolute inset-0 m-auto h-4 w-4 text-white opacity-0 transition-opacity group-hover:opacity-100"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
              >
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-gray-900">Pacific ERP</div>
              <div className="text-[11px] text-gray-400">{subtitle}</div>
            </div>
          </div>
          {children}
        </div>
      </aside>
    </>
  );
}
