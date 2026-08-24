"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import s from "./report.module.css";

/** Outside-dismiss shared by InfoDot and Explain.
 *
 *  Pointer events, not mouse events: iOS Safari only synthesises mouse events
 *  for taps on "clickable" elements, so a tap on blank paper never closed the
 *  panel. But a bare pointerdown fires at the FIRST TOUCH of a scroll gesture
 *  too — swiping the sheet to check the working against the table underneath
 *  closed the panel the moment the finger landed. So: a down-then-up pair that
 *  barely moved is a tap and dismisses; a moving pair, or one the browser took
 *  over for scrolling (pointercancel), is a scroll and leaves the panel open.
 *  On a mouse this is a click, exactly as before. */
function useAwayDismiss(open: boolean, setOpen: (v: boolean) => void, box: RefObject<HTMLSpanElement | null>) {
  useEffect(() => {
    if (!open) return;
    let start: { id: number; x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      start = box.current?.contains(e.target as Node) ? null : { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10) setOpen(false);
      start = null;
    };
    const cancel = () => { start = null; };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", esc);
    };
  }, [open, setOpen, box]);
}

/** The "i" beside a derived figure: click it and it shows the arithmetic that
 *  produced the number, in the same terms the tables use.
 *
 *  Click, not hover. A hover tooltip cannot be read on a touch screen and
 *  cannot be kept open while you check it against the table underneath.
 *  Hidden in print — see report.module.css. */
export function InfoDot({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useAwayDismiss(open, setOpen, box);

  return (
    <span className={s.info} ref={box}>
      <button
        type="button"
        className={s.infoDot}
        aria-expanded={open}
        aria-label={`How ${label} is calculated`}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open && <span className={s.infoPop} role="note">{children}</span>}
    </span>
  );
}

/** Click-to-explain without an icon: the figure itself is the control, marked
 *  by a hairline under it. Used everywhere the "i" is not — the band at the top
 *  of each sheet keeps its "i", and putting one on every explainable number in
 *  the tables turned the page into a rash of glyphs.
 *
 *  Click rather than hover, for the same reasons the "i" uses click: a touch
 *  screen cannot hover, and a panel that vanishes when the pointer moves cannot
 *  be read against the row it explains. */
export function Explain({ label, tip, children }: { label: string; tip: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useAwayDismiss(open, setOpen, box);

  return (
    <span ref={box} style={{ position: "relative" }}>
      <button
        type="button"
        className={s.hoverWrap}
        aria-expanded={open}
        aria-label={`How ${label} is arrived at`}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
        {open && <span className={s.hoverTip} role="note">{tip}</span>}
      </button>
    </span>
  );
}

/** One line of a working: a description on the left, its value on the right. */
export function Line({ of, is }: { of: string; is: string }) {
  return <span className={s.infoRow}><span>{of}</span><b>{is}</b></span>;
}

export function Sum({ of, is }: { of: string; is: string }) {
  return <span className={`${s.infoRow} ${s.infoSum}`}><span>{of}</span><b>{is}</b></span>;
}
