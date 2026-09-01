import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PHOTO_SLOTS, ALL_PHOTO_FIELDS, SINGLE_PHOTO_FIELD, PHOTO_PAIR_MODELS,
  hasPhotoPair, slotOfFilename, PAIR_TARGET, PAIR_HARD_MAX,
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

test("the QC photos are optional — the form may not refuse a slab for a missing one", () => {
  // The owner's rule, 2026-09-01: "like the slab intake form but not mandatory".
  // QC runs slab after slab; a required camera would stop the line.
  const pairBlock = entryForm.slice(entryForm.indexOf("function PhotoFields"), entryForm.indexOf("function PumpBoxes"));
  assert.ok(pairBlock.includes("PHOTO_SLOTS.map"), "the pair should be rendered in PhotoFields");
  assert.ok(!/required/.test(pairBlock), "no photo slot on the QC form may be marked required");
  for (const [name, s] of [["the QC entry form", entryForm], ["the tables editor", tablesEditor]] as const) {
    assert.ok(
      !s.includes("requiredPhotoProblem") && !s.includes("saveRequiredPhoto"),
      `${name} must not use the intake form's mandatory-photo path`,
    );
  }
});
