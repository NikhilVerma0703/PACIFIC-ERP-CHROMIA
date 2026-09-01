"use client";

// Full-screen photo viewer. A defect photo is the evidence behind a grade, and
// a 112px thumbnail cannot settle an argument about a chip or a pinhole — so a
// click opens it at the size of the screen, with the pair navigable in place.
//
// Opening the raw /api/photo URL in a new tab was the old answer and a poor
// one: it left the slab panel behind, gave no caption, and on a tablet it
// meant finding the way back through browser chrome.

import { useCallback, useEffect } from "react";

export interface LightboxPhoto { id: string; filename: string; slot?: string }

const CAPTION: Record<string, string> = {
  far: "Far — the whole slab",
  near: "Near — close on the defect",
};

export function Lightbox({
  photos, index, onClose, onIndex, title,
}: {
  photos: LightboxPhoto[];
  /** null = closed. */
  index: number | null;
  onClose: () => void;
  onIndex: (i: number) => void;
  title?: string;
}) {
  const open = index != null && index >= 0 && index < photos.length;
  const step = useCallback((d: number) => {
    if (index == null || photos.length === 0) return;
    onIndex((index + d + photos.length) % photos.length);
  }, [index, photos.length, onIndex]);

  // Escape closes, arrows move. Bound while open only, so the page keeps its
  // own keys the rest of the time.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll under the overlay — on a tablet a stray
    // swipe otherwise moves the slab list while the photo sits still.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose, step]);

  if (!open) return null;
  const p = photos[index!];
  const caption = (p.slot && CAPTION[p.slot]) || p.filename;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label={caption}
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-white/90">
        <div className="min-w-0">
          <div className="truncate font-medium">{title ?? caption}</div>
          {title && <div className="truncate text-xs text-white/60">{caption}</div>}
        </div>
        <div className="flex items-center gap-2">
          {photos.length > 1 && <span className="text-xs text-white/60">{index! + 1} of {photos.length}</span>}
          <a
            href={`/api/photo?id=${p.id}`} target="_blank" rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg border border-white/25 px-3 py-1.5 text-xs text-white hover:bg-white/10"
          >
            Open original
          </a>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            aria-label="Close photo"
            className="rounded-lg border border-white/25 px-3 py-1.5 text-xs text-white hover:bg-white/10"
          >
            Close ✕
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-4">
        {photos.length > 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); step(-1); }}
            aria-label="Previous photo"
            className="absolute left-3 z-10 rounded-full border border-white/25 bg-black/40 px-3 py-2 text-white hover:bg-white/15"
          >
            ‹
          </button>
        )}
        {/* object-contain: a slab photo is wide and must never be cropped to
            fit — the whole point is seeing the defect in its place.
            eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/photo?id=${p.id}`}
          alt={caption}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full cursor-default rounded-lg object-contain shadow-2xl"
        />
        {photos.length > 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); step(1); }}
            aria-label="Next photo"
            className="absolute right-3 z-10 rounded-full border border-white/25 bg-black/40 px-3 py-2 text-white hover:bg-white/15"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}
