"use client";

// The two banners every fabrication station screen needs, in one place so all
// five say the same thing in the same words.
//
// They are deliberately different shapes. A LOAD failure is a warning about what
// is on screen — the list may be stale, and an empty queue might not mean an
// empty queue. An ACTION failure is about something the operator just did that
// did NOT happen, so it is red and dismissible: they need to know to do it again.
// Before this, both were invisible.

export function FabAlerts({
  loadError, actionError, onDismiss, noun = "list",
}: {
  loadError?: string | null;
  actionError?: string | null;
  onDismiss?: () => void;
  /** What the queue holds, for the stale-list wording: "pieces", "slabs". */
  noun?: string;
}) {
  return (
    <>
      {loadError && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>This {noun} may be out of date.</b> {loadError} Nothing below is confirmed — an empty
          queue here does not mean there is no work.
        </div>
      )}
      {actionError && (
        <div className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span><b>Not saved.</b> {actionError}</span>
          {onDismiss && (
            <button onClick={onDismiss} aria-label="Dismiss"
              className="shrink-0 font-bold text-red-400 hover:text-red-700">✕</button>
          )}
        </div>
      )}
    </>
  );
}
