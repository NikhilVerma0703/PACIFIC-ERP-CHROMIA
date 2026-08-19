"use client";

import { useEffect, useState } from "react";

/** Paper width or full width, the reader's choice — top-right, beside Print.
 *
 *  The sheet is drawn at 210mm because the page IS the printed document, but
 *  on a wide monitor that leaves most of the screen empty and the hour-by-hour
 *  table tighter than it needs to be. The toggle stamps an attribute on <html>
 *  and report.module.css lifts the sheet and shell widths under it — screen
 *  only, so the printout stays A4 no matter which view is on. The choice
 *  persists, and the attribute is removed on unmount so no other page
 *  inherits it.
 */
const KEY = "ceo-report-wide";
const ATTR = "data-report-wide";

export function WidthToggle() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    let on = false;
    try { on = localStorage.getItem(KEY) === "1"; } catch { /* private mode */ }
    if (on) { setWide(true); document.documentElement.setAttribute(ATTR, "1"); }
    return () => document.documentElement.removeAttribute(ATTR);
  }, []);
  const toggle = () => setWide((w) => {
    const v = !w;
    if (v) document.documentElement.setAttribute(ATTR, "1");
    else document.documentElement.removeAttribute(ATTR);
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ }
    return v;
  });
  return (
    <button
      type="button" onClick={toggle} title={wide ? "Back to the printed-page width" : "Stretch the report to the whole screen"}
      className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      {wide ? "Paper width" : "Full width"}
    </button>
  );
}
