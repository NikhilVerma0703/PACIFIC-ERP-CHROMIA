"use client";

/** Printing the page IS how the PDF is produced — the stylesheet carries @page
 *  and the per-sheet breaks, so what comes out of the browser is the document.
 *  That keeps one design rather than a second one in a PDF library. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      Print / Save as PDF
    </button>
  );
}
