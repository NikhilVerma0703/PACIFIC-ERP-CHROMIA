"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import s from "./report.module.css";

/** The "i" beside a derived figure: click it and it shows the arithmetic that
 *  produced the number, in the same terms the tables use.
 *
 *  Click, not hover. A hover tooltip cannot be read on a touch screen and
 *  cannot be kept open while you check it against the table underneath.
 *  Hidden in print — see report.module.css. */
export function InfoDot({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

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

/** One line of a working: a description on the left, its value on the right. */
export function Line({ of, is }: { of: string; is: string }) {
  return <span className={s.infoRow}><span>{of}</span><b>{is}</b></span>;
}

export function Sum({ of, is }: { of: string; is: string }) {
  return <span className={`${s.infoRow} ${s.infoSum}`}><span>{of}</span><b>{is}</b></span>;
}
