// When a smart entry form may throw away what the operator has typed.
//
// PURE, and in its own file, because the rule it holds is the one that broke.
//
// THE BUG THIS EXISTS TO STOP (polish entry, reported 2026-09-12: "photo when i
// take and click ok, the already filled form clears"). The polish stations
// resolve the batch from the slab number on the slab box's BLUR, and a blur
// fires whenever anything else is tapped — including the camera button. So:
// the operator typed the slab, the form filled, they filled the rest, they
// tapped the photo, the slab box blurred with THE SAME NUMBER in it, the form
// re-resolved it, bumped its `version`, and remounted every field under
// key={`fields-${version}`}. Every defaultValue went back to its default. The
// slab number survived — its key is deliberately stable — so what the operator
// saw was a form that had kept the one field they did not need to retype and
// lost all the ones they did.
//
// Nothing about the camera is special here. The same blur is fired by tapping
// Save, by scrolling on some Android keyboards, and by the operator simply
// checking the slab number and tapping away from it. The camera only made it
// reliable enough to report.
//
// THE RULE. Re-fetching defaults is right when the thing they are defaults FOR
// has changed, and never right otherwise: an identical answer cannot change
// what is on screen, so remounting the fields to apply it can only discard
// typing. One exception, and it is the reason this takes a `force` rather than
// just comparing: after a successful save the form reloads the SAME batch on
// purpose, to advance the slab number and clear the row just entered.

/**
 * Should a blur (or any other trigger) re-fetch defaults and remount the
 * fields?
 *
 * `previous` is the value last loaded successfully, or null when nothing has
 * been loaded yet. `next` is what the box holds now. Whitespace is not a
 * change, and a box emptied to nothing is not a reload — there is nothing to
 * look up.
 */
export function shouldReloadDefaults(previous: string | null, next: string): boolean {
  const want = String(next ?? "").trim();
  if (!want) return false;
  return want !== (previous ?? "").trim();
}
