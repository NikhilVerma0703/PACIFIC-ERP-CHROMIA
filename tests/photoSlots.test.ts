import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PHOTO_SLOTS, ALL_PHOTO_FIELDS, SINGLE_PHOTO_FIELD, PHOTO_PAIR_MODELS,
  hasPhotoPair, slotOfFilename, PAIR_TARGET, PAIR_HARD_MAX,
  rejectPhotosRequired,
} from "../src/lib/photoSlots.ts";
import { DEFECT_PHOTOS } from "../src/lib/inventory/intakeRules.ts";

// The far/near pair is carried by three screens — slab intake (mandatory), the
// Polish QC entry form and the tables editor (both optional) — and stored by
// one save path. What breaks silently is DRIFT: a field renamed on one screen
// is a photo posted under a name the server never reads, with no error anywhere
// because photos are best-effort by design. These pin the single definition.

test("the pair is one list, and the intake form's DEFECT_PHOTOS is that list", () => {
  // Not "equal to" — the SAME array. A copy could be edited on one side only.
  assert.equal(DEFECT_PHOTOS, PHOTO_SLOTS);
  assert.deepEqual(PHOTO_SLOTS.map((p) => p.slot), ["far", "near"]);
});

test("every slot is fully described — no half-filled entry reaches a form", () => {
  for (const p of PHOTO_SLOTS) {
    assert.ok(p.field.startsWith("__"), `${p.slot}: field must be a __ non-column name`);
    assert.ok(p.prefix.endsWith("-"), `${p.slot}: prefix must end with - so it cannot swallow a filename`);
    for (const k of ["title", "hint", "label", "short"] as const) {
      assert.ok(p[k] && p[k].trim().length > 0, `${p.slot}: ${k} must say something`);
    }
  }
  const fields = PHOTO_SLOTS.map((p) => p.field);
  assert.equal(new Set(fields).size, fields.length, "two slots sharing a field would overwrite each other");
  const prefixes = PHOTO_SLOTS.map((p) => p.prefix);
  assert.equal(new Set(prefixes).size, prefixes.length, "two slots sharing a prefix are unreadable apart");
});

test("the save path's field list is the single photo plus every slot", () => {
  assert.deepEqual(
    ALL_PHOTO_FIELDS.map((f) => f.field),
    [SINGLE_PHOTO_FIELD, ...PHOTO_SLOTS.map((p) => p.field)],
    "a slot missing here is a photo the form posts and the server drops in silence",
  );
  assert.equal(ALL_PHOTO_FIELDS[0].prefix, "", "the generic photo keeps its filename unprefixed");
  for (const p of PHOTO_SLOTS) {
    assert.equal(ALL_PHOTO_FIELDS.find((f) => f.field === p.field)?.prefix, p.prefix);
  }
});

test("a stored filename says which slot it came from, and never guesses", () => {
  for (const p of PHOTO_SLOTS) {
    assert.equal(slotOfFilename(p.prefix + "IMG_2231.jpg"), p.slot);
  }
  // Photos from the generic field, from before the pair existed, or from
  // nothing at all are unlabelled — not silently filed as "far".
  assert.equal(slotOfFilename("IMG_2231.jpg"), null);
  assert.equal(slotOfFilename(""), null);
  assert.equal(slotOfFilename(null), null);
  assert.equal(slotOfFilename(undefined), null);
});

test("the pair's budget fits two photos in one ~4.5 MB request body", () => {
  assert.ok(PAIR_TARGET < PAIR_HARD_MAX, "the target must be under the hard cap");
  assert.ok(
    PAIR_HARD_MAX * PHOTO_SLOTS.length < 4_500_000,
    "both photos at their hard cap must still fit the request body, or a full QC entry is lost to a 413",
  );
});

test("Polish QC is where the pair is offered, by one predicate", () => {
  assert.ok(hasPhotoPair("PolishQc"), "the QC form is the reason this pair exists outside intake");
  assert.equal(hasPhotoPair("Press"), false, "every other station keeps its single photo");
  assert.equal(hasPhotoPair(""), false);
  assert.ok(PHOTO_PAIR_MODELS.includes("PolishQc"));
});

// ---------------------------------------------------------------------------
// Structural guards. These read the source rather than call it, because what
// they protect is not a value but a PLACE: one definition of the field names,
// one predicate for who offers them, and a QC form that never demands them.

const src = (p: string) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8");
const entryForm = src("components/SmartSlabForm.tsx");
const tablesEditor = src("components/RecordEditor.tsx");
const savePath = src("lib/entryPhoto.ts");

function everySourceFile(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) everySourceFile(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

test("the photo field names are written in exactly one file", () => {
  const home = join("src", "lib", "photoSlots.ts");
  const offenders = everySourceFile(fileURLToPath(new URL("../src", import.meta.url)))
    .filter((f) => !f.endsWith(home))
    .filter((f) => /["'`]__photo/.test(readFileSync(f, "utf8")));
  assert.deepEqual(
    offenders.map((f) => f.slice(f.indexOf("src"))), [],
    "a photo field name spelled outside photoSlots.ts can drift from the one the server reads",
  );
});

test("the save path walks the whole list instead of naming a field", () => {
  assert.ok(
    savePath.includes("for (const { field, prefix } of ALL_PHOTO_FIELDS)"),
    "savePhotoFromForm must iterate ALL_PHOTO_FIELDS — a hand-picked field drops the rest without an error",
  );
  assert.ok(
    savePath.includes("continue;") && !/fd\.get\("__photo"\)/.test(savePath),
    "one unusable file must skip its own slot, not return and abandon the others",
  );
});

test("the QC form and the tables editor ask the same question about the same models", () => {
  for (const [name, s] of [["the QC entry form", entryForm], ["the tables editor", tablesEditor]] as const) {
    assert.ok(s.includes("hasPhotoPair(model)"), `${name} must decide by hasPhotoPair, not its own model list`);
    assert.ok(s.includes("PHOTO_SLOTS.map"), `${name} must render the shared slots`);
    assert.ok(
      s.includes("PAIR_TARGET") && s.includes("PAIR_HARD_MAX"),
      `${name} carries two photos in one body — it must use the pair's tighter compression budget`,
    );
  }
});

test("the QC photos stay optional on every grade but a reject", () => {
  // THIS TEST WAS NARROWED ON 2026-09-04, and the history matters because the
  // narrowing looks like a reversal and is not.
  //
  // Owner, 2026-09-01: "like the slab intake form but not mandatory" — QC runs
  // slab after slab and a required camera stops the line. This test asserted
  // that no slot on the QC form could say "required" at all.
  //
  // Owner, 2026-09-03: a C (Reject) may not be saved without both photos,
  // because a reject is the one verdict somebody comes back to look at. On live
  // Neon 2026-09-04 that is 1,254 of the 44,635 graded slabs; the other 43,381
  // A / A2 / B slabs are untouched, which is the whole of the 2026-09-01
  // decision still standing. Both counts rise every shift — re-measure, don't
  // trust them; the ratio is the point, not the figures.
  //
  // So the assertion is no longer "never required" — it is "required ONLY when
  // the shared predicate says reject", which is the rule as it now stands.
  for (const g of ["A", "A2", "B", "Not graded yet", "CTS", "SAMPLE", "Printing", "", null]) {
    assert.equal(rejectPhotosRequired("PolishQc", g), false,
      `${JSON.stringify(g)} must not require a photo — QC entry must not be stopped for it`);
  }
  assert.equal(rejectPhotosRequired("PolishQc", "C (Reject)"), true, "the one verdict the pair is demanded for");

  const pairBlock = entryForm.slice(entryForm.indexOf("function PhotoFields"), entryForm.indexOf("function PumpBoxes"));
  assert.ok(pairBlock.includes("PHOTO_SLOTS.map"), "the pair should be rendered in PhotoFields");
  // Required must be CONDITIONAL. A constant `status="required"` would put the
  // camera back in front of all 43,360 non-reject slabs.
  assert.ok(!/status=\s*["']required["']/.test(pairBlock), "no slot may be unconditionally required");
  assert.match(pairBlock, /status=\{[^}]*\?/, "the slot's status must be decided per grade, not fixed");

  for (const [name, s] of [["the QC entry form", entryForm], ["the tables editor", tablesEditor]] as const) {
    // Unchanged, and still the point: the intake form's path REFUSES the entry
    // outright, which is not what a reject save does — the row is written and
    // the operator is told what did not land (tables/actions.ts storePhotos).
    assert.ok(
      !s.includes("requiredPhotoProblem") && !s.includes("saveRequiredPhoto"),
      `${name} must not use the intake form's mandatory-photo path`,
    );
    // Neither screen hard-codes the grade it is JUDGING — that half of the old
    // test still holds, and is what keeps CTS out of the rule. Prose is fine
    // (both files explain the rule in comments, and the red banner says
    // "C (Reject)" on screen); a COMPARISON against a grade literal is not.
    assert.ok(
      !/[=!]==?\s*["'`]\s*C[\s("']/.test(s),
      `${name} must ask lib/photoSlots what a reject is, never compare the grade to a literal`,
    );
    assert.ok(
      !/\.(startsWith|includes|match)\(\s*["'`/]\s*C[\s("']/.test(s),
      `${name} must not sniff the grade string itself — that is how CTS became a reject in gradeCredit`,
    );
  }
});
