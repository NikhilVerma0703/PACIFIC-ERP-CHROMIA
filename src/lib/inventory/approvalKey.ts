// The ONE way a (design, batch) approval key is built.
//
// Sales approval is keyed by a pair, and two places derive that pair: the gate
// that decides which slabs are withheld (getUnapprovedSlabNumbers) and the slab
// intake form, which approves the pair of a slab it saves. If those two derive
// it even slightly differently, the form writes a row the gate never looks up:
// the approval is stored, the screen says the slab was approved, and the slab
// stays hidden. That is not a loud failure — it is a lie on screen.
//
// It happened once already, over the empty string: displayBatch("") is an em
// dash, and a second implementation read "" as "-". So there is no second
// implementation any more. Both sides call this, and the tests pin every batch
// shape the plant writes.
//
// Import-free apart from displayBatch (itself import-free), so `node --test`
// reaches it — same reason lib/roles.ts and preventiveMaintenanceShared.ts are
// split out. Relative .ts import for the same reason.
import { displayBatch } from "../batchDisplay.ts";

/** What a slab with no design at all is filed under, on both sides. */
export const NO_DESIGN = "(no design)";
/** What a slab with NO batch is filed under. An EMPTY batch is not the same
 *  thing: it goes through displayBatch like any other string. */
export const NO_BATCH = "-";

export interface ApprovalKey {
  design: string;
  batch: string;
}

/**
 * The approval key for a slab.
 *
 * `design` must already be canonical — resolved through DesignAlias by the
 * caller, which is async and differs between the two sites (the gate holds a
 * map of every alias, the form looks one up). What must NOT differ is
 * everything below, so it lives here.
 */
export function approvalKey(canonicalDesign: string | null | undefined, batch: string | null | undefined): ApprovalKey {
  return {
    design: canonicalDesign ?? NO_DESIGN,
    // NULL means "this slab has no batch". An empty or blank string is a batch
    // that was typed and came to nothing, and displayBatch decides what that
    // reads as — do not shortcut it to NO_BATCH.
    batch: batch == null ? NO_BATCH : displayBatch(batch),
  };
}

/** The separator the gate has always used. NUL can appear in neither a design
 *  nor a batch, so no pair of real values can collide with another pair. Built
 *  with fromCharCode rather than a string escape so that no editor, patch or
 *  copy-paste can turn it into a real control character in the source — which
 *  is exactly what happened once while writing this file. */
export const KEY_SEP = String.fromCharCode(0);

/** The two halves joined for a Set/Map lookup. */
export function approvalKeyString(k: ApprovalKey): string {
  return `${k.design}${KEY_SEP}${k.batch}`;
}
