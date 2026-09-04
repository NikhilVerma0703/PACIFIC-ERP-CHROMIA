import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PHOTO_SLOTS, REJECT_GRADE_FIELD, REJECT_PHOTOS_RULE,
  REJECT_GRADE_NOT_HERE_MESSAGE, REJECT_GRADE_ROUTE, PHOTO_WARN_PREFIX,
  isRejectGrade, rejectPhotosRequired, hasPhotoPair,
  rejectPhotoDecision, rejectGradeNotHere, photoProblem,
  type PhotoSlotName,
} from "../src/lib/photoSlots.ts";
import { mergeFromOlder } from "../src/lib/dedupMerge.ts";
import { GRADE_OPTIONS } from "../src/lib/inventory/intakeRules.ts";

// THE REJECT-PHOTO RULE (owner, 2026-09-03): a Polish QC slab graded C may not
// be saved without BOTH the far and the near photo. Every other grade is
// unchanged — the pair stays optional there, which is the 2026-09-01 decision
// this one narrows.
//
// What these pin is the PREDICATE and the two PLACES it has to run. The
// predicate, because "does this grade mean reject" has one wrong answer that
// has already cost this codebase money (see the CTS block below). The places,
// because a rule enforced on create and forgotten on edit is not a rule.

// ---------------------------------------------------------------------------
// The predicate
// ---------------------------------------------------------------------------

/** Every quality_grade value polish_qc actually holds, re-counted on live Neon
 *  2026-09-04: A 37,926 / 'Not graded yet' 3,651 / A2 3,072 / B 2,383 /
 *  'C (Reject)' 1,254 / null 194 — six distinct values and no seventh. Not a
 *  spec: a census, and the reason the predicate has to match 'C (Reject)'
 *  rather than 'C'. The COUNTS move every shift (A and the rejects both rose
 *  during 2026-09-04 alone); what this list pins is the set of spellings. */
const LIVE_GRADES: [string | null, boolean][] = [
  ["A", false],
  ["Not graded yet", false],
  ["A2", false],
  ["B", false],
  ["C (Reject)", true],
  [null, false],
];

test("every grade value the live table holds is judged correctly", () => {
  for (const [grade, want] of LIVE_GRADES) {
    assert.equal(isRejectGrade(grade), want, `${JSON.stringify(grade)} should ${want ? "" : "not "}be a reject`);
  }
  // The dropdown offers exactly one reject spelling; if a second is ever added
  // to lib/tables.ts this list is where the rule gets told about it.
  assert.equal(LIVE_GRADES.filter(([, w]) => w).length, 1);
});

test("CTS IS NOT A REJECT — the mistake this predicate exists to prevent", () => {
  // "CTS".startsWith("C") is true. shiftScoreMath's gradeCredit carries the scar
  // of taking that shortcut: cut-to-size slabs scored as rejects, 37 of them
  // live, each costing its shift 9 points. CTS, SAMPLE and Printing are
  // ROUTINGS — where the slab goes next — not verdicts on it, and demanding
  // defect photographs of a slab nobody found a defect on would teach the QC
  // operator to pick a different grade to get past the form.
  assert.equal(isRejectGrade("CTS"), false);
  assert.equal(isRejectGrade("cts"), false);
  assert.equal(isRejectGrade("CTS (Cut to size)"), false);
  assert.equal(isRejectGrade("SAMPLE"), false);
  assert.equal(isRejectGrade("Sample"), false);
  assert.equal(isRejectGrade("Printing"), false);
  assert.equal(isRejectGrade("Chromia"), false);
  // The whole inventory grade list, judged in one sweep: only the bare C counts.
  const rejects = GRADE_OPTIONS.filter((g) => isRejectGrade(g));
  assert.deepEqual(rejects, ["C"], "exactly one of A / A2 / B / C / CTS / SAMPLE / Printing is a reject");
});

test("the reject verdict is caught however it is spelled", () => {
  // The stored value, the intake list's bare letter, and what a typed-in
  // "+ Add new…" grade could plausibly look like around them.
  for (const g of ["C", "c", " C ", "C (Reject)", "c (reject)", "  C (REJECT)  ", "C-Reject", "C reject"]) {
    assert.equal(isRejectGrade(g), true, `${JSON.stringify(g)} is the reject verdict`);
  }
});

test("nothing empty, absent or unrelated is mistaken for a reject", () => {
  for (const g of [null, undefined, "", "   ", "—", "-", "0", "Not graded yet", "NOT GRADED", "A", "A2", "B", "B2", "C2", "CC"]) {
    assert.equal(isRejectGrade(g), false, `${JSON.stringify(g)} must not demand photos`);
  }
});

test("the rule applies only where the pair is offered at all", () => {
  assert.equal(rejectPhotosRequired("PolishQc", "C (Reject)"), true);
  assert.equal(rejectPhotosRequired("PolishQc", "B"), false, "every other grade is unchanged — the 2026-09-01 decision stands");
  assert.equal(rejectPhotosRequired("PolishQc", "CTS"), false);
  // A grade column exists on other stations' rows too; only the models that
  // carry the far/near pair can be asked for it.
  assert.equal(rejectPhotosRequired("Press", "C (Reject)"), false);
  assert.equal(rejectPhotosRequired("", "C (Reject)"), false);
  for (const m of ["PolishQc", "Press", "Mis"]) {
    if (!hasPhotoPair(m)) assert.equal(rejectPhotosRequired(m, "C"), false, `${m} has no pair to demand`);
  }
});

test("the refusal names WHICH photo, out of the labels photoSlots already owns", () => {
  // "photo required" in front of two empty slots is not an instruction. The
  // `label` field exists for this sentence and is the only text used for it.
  assert.ok(REJECT_PHOTOS_RULE.includes("C (Reject)"), "the rule sentence must say which grade triggered it");
  for (const p of PHOTO_SLOTS) {
    const sentence = `${REJECT_PHOTOS_RULE} The ${p.label} is required — attach it before saving.`;
    assert.ok(sentence.includes(p.label), `${p.slot}: the refusal must carry the slot's own label`);
    assert.ok(/\(.+\)/.test(p.label), `${p.slot}: the label must still say what the photo shows`);
  }
  assert.notEqual(PHOTO_SLOTS[0].label, PHOTO_SLOTS[1].label, "two slots refusing with one sentence names neither");
});

// ---------------------------------------------------------------------------
// THE DECISION ITSELF.
//
// Until 2026-09-04 the four rules below lived as branches inside
// tables/actions.ts and nothing here could call them: the server-side tests
// matched the SOURCE TEXT with regexes, so every one of them still passed with
// the branches inverted, with the already-on-file skip widened to both slots,
// or with the loop returning "allowed" on the first satisfied slot. The
// predicate was covered; the decision was not. rejectPhotoDecision is that
// decision as a pure function — the caller does the two reads and the FormData
// validation, and these run the whole matrix against it.
// ---------------------------------------------------------------------------

const FAR: PhotoSlotName = "far";
const NEAR: PhotoSlotName = "near";
const BOTH: PhotoSlotName[] = [FAR, NEAR];
/** A save of `grade` on PolishQc — the defaults are a CREATE (no stored row). */
const decide = (o: {
  grade?: string | null; prevGrade?: string | null;
  storedSlots?: PhotoSlotName[]; missingSlots?: PhotoSlotName[]; model?: string;
}) => rejectPhotoDecision({
  model: o.model ?? "PolishQc",
  grade: o.grade === undefined ? "C (Reject)" : o.grade,
  prevGrade: o.prevGrade ?? null,
  storedSlots: o.storedSlots ?? [],
  missingSlots: o.missingSlots ?? BOTH,
});

test("CREATE: a reject carrying neither photo, or only one, is refused BY NAME", () => {
  // Refused by name, because "a photo is required" in front of two empty slots
  // is not an instruction — the operator has to know which camera to pick up.
  assert.deepEqual(decide({ missingSlots: BOTH }), { refuse: true, slot: FAR },
    "neither photo attached — the refusal names the far one first");
  assert.deepEqual(decide({ missingSlots: [NEAR] }), { refuse: true, slot: NEAR },
    "far attached, near missing — name the near one");
  assert.deepEqual(decide({ missingSlots: [FAR] }), { refuse: true, slot: FAR },
    "near attached, far missing — name the far one");
  // Order comes from PHOTO_SLOTS, not from however the caller built its list.
  assert.deepEqual(decide({ missingSlots: [NEAR, FAR] }), { refuse: true, slot: FAR });
});

test("CREATE: a reject carrying BOTH photos is allowed, and only for that reason", () => {
  assert.deepEqual(decide({ missingSlots: [] }), { refuse: false, why: "pair-supplied" });
});

test("CREATE: photos on file cannot let a reject through — there is no row yet", () => {
  // A create passes prevGrade null and no stored slots BY CONSTRUCTION. If a
  // caller ever hands it another slab's photos, the decision must still refuse:
  // the create path has nothing legitimate to fall back on.
  assert.deepEqual(decide({ storedSlots: BOTH, missingSlots: BOTH, prevGrade: null }),
    { refuse: false, why: "on-file" },
    "stored slots satisfy their own slot — which is why a CREATE must never be given any");
  // and the guard in tables/actions.ts is what enforces that: it passes none.
  assert.match(actionBody("createRow"), /rejectPhotoRefusal\(fd, model, data\.qualityGrade, null\)/);
});

test("EVERY grade, judged: only a reject is ever stopped", () => {
  for (const [grade, isReject] of LIVE_GRADES) {
    const d = decide({ grade, missingSlots: BOTH });
    if (isReject) assert.equal(d.refuse, true, `${JSON.stringify(grade)} must be stopped without photos`);
    else assert.deepEqual(d, { refuse: false, why: "not-a-reject" },
      `${JSON.stringify(grade)} must pass, and for the RIGHT reason — QC entry is not stopped for it`);
  }
  // The routings, which are where the whole predicate came from.
  for (const g of ["CTS", "SAMPLE", "Printing", "cts", "CTS (Cut to size)"]) {
    assert.deepEqual(decide({ grade: g, missingSlots: BOTH }), { refuse: false, why: "not-a-reject" },
      `${g} is a routing, not a verdict — it must never be asked for defect photographs`);
  }
  // Spelled any of the ways the live table and the dropdown can produce.
  for (const g of ["C", "c", " C ", "C (Reject)", "c (reject)", "C-Reject"]) {
    assert.equal(decide({ grade: g, missingSlots: BOTH }).refuse, true, `${JSON.stringify(g)} is a reject`);
  }
});

test("EDIT: a grade CHANGED to a reject is stopped; a row that was already one is not", () => {
  // THE ROWS THIS PROTECTS. Measured on live Neon 2026-09-04: 1,254
  // 'C (Reject)' rows, exactly ONE with both photos — 6 far-only, 8 near-only,
  // 1,239 with neither — because the pair was optional here until 2026-09-03.
  // Re-judging an untouched reject would make those 1,253 uncorrectable
  // forever, for slabs nobody can photograph now, so the rule bites only where
  // the owner asked: on a grade being CHANGED to C. He confirmed this shape on
  // 2026-09-04. The count rises every shift; the rule does not move with it.
  assert.deepEqual(decide({ prevGrade: "B", missingSlots: BOTH }), { refuse: true, slot: FAR },
    "B → C (Reject) with no photos is the back door this rule closes");
  assert.deepEqual(decide({ prevGrade: "A", missingSlots: BOTH }), { refuse: true, slot: FAR });
  assert.deepEqual(decide({ prevGrade: null, missingSlots: BOTH }), { refuse: true, slot: FAR },
    "an ungraded row becoming a reject is a grade being CHANGED to one");
  assert.deepEqual(decide({ prevGrade: "Not graded yet", missingSlots: BOTH }), { refuse: true, slot: FAR });
  for (const prev of ["C (Reject)", "C", "c (reject)"]) {
    assert.deepEqual(decide({ prevGrade: prev, missingSlots: BOTH }), { refuse: false, why: "already-a-reject" },
      `a row already reading ${JSON.stringify(prev)} must stay correctable with no photos`);
  }
  // CTS is not a previous reject, so a CTS row regraded C is still stopped.
  assert.deepEqual(decide({ prevGrade: "CTS", missingSlots: BOTH }), { refuse: true, slot: FAR });
});

test("EDIT: a photo ALREADY on file satisfies ITS OWN slot, and only its own", () => {
  // Editing the remarks of a properly photographed reject must not demand a
  // re-upload of a slab that left the bay months ago. But a far photo on file
  // does not answer for a missing near one — that is the widening this test
  // exists to catch.
  assert.deepEqual(decide({ prevGrade: "B", storedSlots: [FAR], missingSlots: BOTH }),
    { refuse: true, slot: NEAR }, "far on file, near still owed");
  assert.deepEqual(decide({ prevGrade: "B", storedSlots: [NEAR], missingSlots: BOTH }),
    { refuse: true, slot: FAR }, "near on file, far still owed");
  assert.deepEqual(decide({ prevGrade: "B", storedSlots: BOTH, missingSlots: BOTH }),
    { refuse: false, why: "on-file" }, "both on file — never demand them twice");
  // One carried in this request, the other on file, is a complete pair.
  assert.deepEqual(decide({ prevGrade: "B", storedSlots: [FAR], missingSlots: [FAR] }),
    { refuse: false, why: "on-file" });
  assert.deepEqual(decide({ prevGrade: "B", storedSlots: [NEAR], missingSlots: [NEAR] }),
    { refuse: false, why: "on-file" });
  // And a stored photo cannot rescue the WRONG slot.
  assert.deepEqual(decide({ prevGrade: "B", storedSlots: [FAR], missingSlots: [NEAR] }),
    { refuse: true, slot: NEAR });
});

test("the decision applies only where the pair is offered at all", () => {
  for (const m of ["Press", "Jot", "Mis", ""]) {
    assert.deepEqual(decide({ model: m, missingSlots: BOTH }), { refuse: false, why: "not-a-reject" },
      `${m || "(no model)"} carries no far/near pair — it cannot be asked for one`);
  }
  assert.equal(decide({ model: "PolishQc", missingSlots: BOTH }).refuse, true);
});

// ---------------------------------------------------------------------------
// The places. These read the source rather than call it, because what they
// protect is not a value but a PLACE — and the failure they catch (a rule on
// one path only) is invisible from the path that has it.
// ---------------------------------------------------------------------------

const src = (p: string) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8");
const actions = src("app/tables/actions.ts");
const entryForm = src("components/SmartSlabForm.tsx");
const tablesEditor = src("components/RecordEditor.tsx");

/** The body of one top-level action, so "createRow guards it" cannot be
 *  satisfied by a call sitting in saveRow forty lines away. */
function actionBody(name: string): string {
  const start = actions.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} not found in tables/actions.ts`);
  const next = actions.slice(start + 1).search(/\nexport async function /);
  return next === -1 ? actions.slice(start) : actions.slice(start, start + 1 + next);
}

test("BOTH server paths enforce it — the create door and the edit door", () => {
  // THE BACK DOOR is the dominant bug class in this repo. Guarded on create
  // alone, the rule is decoration: save the slab as B, open the record in
  // /tables/PolishQc/<id>, change the grade to C, save. Nothing stops it.
  for (const name of ["createRow", "saveRow"]) {
    assert.match(
      actionBody(name), /await rejectPhotoRefusal\(/,
      `${name} must run the reject-photo rule — a rule on one path only is not a rule`,
    );
  }
  assert.match(
    actionBody("createRow"), /rejectPhotoRefusal\(fd, model, data\.qualityGrade, null\)/,
    "a create has no stored row to fall back on — it must pass a null id",
  );
  assert.match(
    actionBody("saveRow"), /rejectPhotoRefusal\(fd, model, data\.qualityGrade, id\)/,
    "an edit must pass the record id, or stored photos cannot count and old rejects brick",
  );
});

test("the server refuses BEFORE the row is written", () => {
  const body = actionBody("createRow");
  const guard = body.indexOf("rejectPhotoRefusal(");
  const create = body.search(/\.create\(\{ data: base \}\)|\$transaction\(/);
  assert.ok(guard > -1 && create > -1 && guard < create,
    "a refused reject must leave no row behind — check the grade before the INSERT, not after");
  // And AFTER the "Not graded yet" default, so the grade judged is the grade stored.
  const dflt = body.indexOf('data.qualityGrade = "Not graded yet"');
  assert.ok(dflt > -1 && dflt < guard, "judge the grade the row will actually carry");
});

test("the edit path reads the two facts the decision needs, and judges with them", () => {
  const helper = actions.slice(actions.indexOf("async function rejectPhotoRefusal"), actions.indexOf("export async function saveRow"));
  assert.match(helper, /entry_photo/,
    "stored photos must be looked up — demanding a re-upload of a slab that has left the bay is a rule nobody can obey");
  assert.match(helper, /slotOfFilename/,
    "a stored photo counts against ITS OWN slot; a far photo does not satisfy the near one");
  assert.match(helper, /qualityGrade: true/,
    "the row's PREVIOUS grade must be read, or an old reject cannot be told from one being created now");
  assert.match(helper, /requiredPhotoProblem\(/,
    "an attached file must be judged by the same size/type limits savePhotoFromForm applies silently, or a 9 MB photo passes the guard and is then dropped");
  // And the judging itself is the shared pure function, not a second copy of
  // the four rules. The matrix above is what actually tests them; this is what
  // keeps this path wired to it.
  assert.match(helper, /rejectPhotoDecision\(\{/,
    "the decision belongs to lib/photoSlots, where it can be unit-tested — inline branches here were provably un-testable");
  assert.match(helper, /prevGrade,?\s*$|prevGrade:/m,
    "the previous grade must reach the decision");
  assert.match(helper, /storedSlots/, "the stored slots must reach the decision");
});

test("the two client screens draw the rule, and ask the shared predicate", () => {
  for (const [name, s] of [["the QC entry form", entryForm], ["the tables editor", tablesEditor]] as const) {
    assert.match(s, /from "@\/lib\/photoSlots"/, `${name} must import the shared definitions`);
    assert.ok(
      s.includes("rejectPhotosRequired") || s.includes("isRejectGrade"),
      `${name} must ask lib/photoSlots whether this grade is a reject, never test the letter itself`,
    );
    assert.ok(
      !/startsWith\(\s*["']C["']\s*\)/.test(s),
      `${name}: a bare startsWith("C") matches CTS — that is the bug gradeCredit already paid for`,
    );
    assert.ok(s.includes("REJECT_PHOTOS_RULE"), `${name} must refuse with the shared sentence`);
    assert.ok(s.includes(`status={`), `${name} must mark the slots required on screen, not only at Save`);
    assert.ok(
      s.includes(`t.name === REJECT_GRADE_FIELD`),
      `${name} must watch the grade field by its shared name — a screen watching "grade" while the server reads "qualityGrade" draws a rule it never applies`,
    );
  }
  assert.equal(REJECT_GRADE_FIELD, "qualityGrade", "the column the whole rule keys off");
});

test("the client refusal is a courtesy, never the enforcement", () => {
  // createRow's own comment: "Mandatory fields (client `required` can be
  // bypassed — enforce here too)". Same here — so no screen may be the only
  // place the rule lives.
  for (const [name, s] of [["the QC entry form", entryForm], ["the tables editor", tablesEditor]] as const) {
    assert.ok(s.includes("preventDefault"), `${name} should stop the submit itself, so nobody uploads twice to learn the rule`);
  }
  assert.match(actions, /const rErr = await rejectPhotoRefusal/,
    "the server must refuse independently of anything a form did or did not check");
});

// ---------------------------------------------------------------------------
// THE THIRD DOOR (owner, 2026-09-04)
//
// Two paths were guarded and a third was missed: createVerifiedSlab — the batch
// "Add & verify slab" flow — inlines its own copy of buildData, renders no photo
// input of any kind, and PRE-FILLS every editable value off a neighbouring slab.
// On a batch whose previous slab was a reject the grade box opened reading
// 'C (Reject)', one tap from an undocumented reject with zero photos.
//
// The owner's answer was NOT to bolt a camera onto a form built for another
// job: "Dont let it add c grade slabs. Instead prompt the user saying you can
// only add non-c grade slabs; if you really want to add c grade slabs either do
// it from tables or from the qc form."
// ---------------------------------------------------------------------------

const addForm = src("app/batch/slabs/AddSlabForm.tsx");
const addPage = src("app/batch/slabs/add/page.tsx");

test("a photoless form refuses the reject grade, and only the reject grade", () => {
  assert.equal(rejectGradeNotHere("PolishQc", "C (Reject)"), REJECT_GRADE_NOT_HERE_MESSAGE);
  assert.equal(rejectGradeNotHere("PolishQc", "c"), REJECT_GRADE_NOT_HERE_MESSAGE);
  for (const g of ["A", "A2", "B", "Not graded yet", "CTS", "SAMPLE", "Printing", "", null, undefined]) {
    assert.equal(rejectGradeNotHere("PolishQc", g), null,
      `${JSON.stringify(g)} must still be addable from the batch screen — that screen exists to fill gaps`);
  }
  // Press, Oven, Jot and the rest have no reject rule at all; nothing changes there.
  for (const m of ["Press", "Oven", "Jot", "PolishEntry"]) {
    assert.equal(rejectGradeNotHere(m, "C (Reject)"), null, `${m} carries no far/near pair`);
  }
});

test("the refusal is a ROUTE — it names both places that can take a reject", () => {
  // "You can't do that here" leaves an operator standing at the batch screen
  // with a reject slab and nowhere to put it. The message has to say where.
  assert.match(REJECT_GRADE_ROUTE, /Polish QC/, "the QC entry form must be named");
  assert.match(REJECT_GRADE_ROUTE, /Tables/, "the tables editor must be named");
  assert.match(REJECT_GRADE_ROUTE, /Not graded yet/,
    "and what to do HERE instead — add the slab ungraded, so the gap in the batch still closes");
  // In the plant's words: the dropdown says 'C (Reject)', so the refusal does.
  assert.match(REJECT_GRADE_NOT_HERE_MESSAGE, /C \(Reject\)/);
  // Both photos named, out of the labels photoSlots already owns.
  for (const p of PHOTO_SLOTS) {
    assert.ok(REJECT_GRADE_NOT_HERE_MESSAGE.includes(p.label),
      `${p.slot}: the refusal must say which two photos the other screens will ask for`);
  }
});

test("the Add & verify screen refuses it on the way in and on the way out", () => {
  assert.match(addForm, /from "@\/lib\/photoSlots"/, "it must ask the shared predicate, not test the letter itself");
  assert.match(addForm, /rejectGradeNotHere\(/, "the refusal must be the shared one");
  assert.ok(!/startsWith\(\s*["']C["']\s*\)/.test(addForm),
    'a bare startsWith("C") matches CTS — the bug gradeCredit already paid for');
  assert.match(addForm, /t\.name === REJECT_GRADE_FIELD/,
    "it must watch the grade field by its shared name, so the banner appears when C is picked");
  assert.match(addForm, /fd\.get\(REJECT_GRADE_FIELD\)/,
    "and judge the POSTED value at submit — a mirror only knows what the last change event saw");
  // The pre-fill is the other half: a neighbouring reject must not arrive
  // already selected in the dropdown.
  assert.match(addPage, /rejectPhotosRequired\(/, "the page must strip a pre-filled reject out of the values");
  assert.match(addPage, /form\.values\[REJECT_GRADE_FIELD\] = ""/,
    "blank the grade, so the operator picks one rather than tapping past a wrong one");
});

// ---------------------------------------------------------------------------
// THE STORE, which the guard cannot speak for.
// ---------------------------------------------------------------------------

const storePath = src("lib/entryPhoto.ts");
const photoField = src("components/PhotoField.tsx");

test("on a reject the pair is stored so a FAILURE IS REPORTED, not swallowed", () => {
  // savePhotoFromForm is best-effort BY DESIGN — a shop-floor row must never be
  // lost to its camera. On a C (Reject) that same catch produces exactly the
  // undocumented reject the rule exists to prevent: row saved, zero photos,
  // operator shown a green "Saved". The sibling slab-intake form already solved
  // this with { ok: true, warn: true }.
  assert.match(storePath, /export async function saveRejectPhotoPair/,
    "a reject's pair needs the REPORTING store, not the swallowing one");
  assert.match(storePath, /saveRequiredPhoto\(/,
    "which is the intake form's path — it returns the failure sentence instead of skipping");
  assert.match(actions, /rejectPhotosRequired\(model, grade == null \? null : String\(grade\)\)/,
    "and it is used on a reject save ONLY — every other entry keeps best-effort photos");
  assert.match(actions, /skipFields/,
    "the best-effort walk must skip the slots already stored, or the row carries the same photo twice");
  // Both write paths must fold the warning into their answer.
  for (const name of ["createRow", "saveRow"]) {
    assert.match(actionBody(name), /await storePhotos\(/, `${name} must store through the reporting path`);
    assert.match(actionBody(name), /if \(photoWarn\) return/,
      `${name} must TELL the operator the evidence did not land — "ok" is painted green`);
  }
  // The row is never rolled back: a graded slab must not be lost to its photo.
  assert.ok(!/photoWarn[\s\S]{0,200}\.delete\(/.test(actions),
    "the row stays — the operator re-attaches the photo, they do not re-enter the slab");
});

test("neither screen paints the store-failure warning green, or red", () => {
  // Green is the lie slab-intake documents: it clears the form and the operator
  // walks away from a reject whose evidence was never stored. Red is the other
  // lie — it reads as "nothing saved", and the answer to that is to enter the
  // slab again, which the duplicate guard then refuses.
  assert.equal(PHOTO_WARN_PREFIX, "⚠ Saved");
  for (const [name, s] of [["the QC entry form", entryForm], ["the tables editor", tablesEditor]] as const) {
    assert.match(s, /startsWith\(PHOTO_WARN_PREFIX\)/,
      `${name} must recognise the warning by the shared prefix, not by matching prose`);
    assert.match(s, /startsWith\(PHOTO_WARN_PREFIX\)\s*\?\s*<span className="text-amber/,
      `${name} must paint it as a warning — neither the green of a clean save nor the red of a refusal`);
  }
});

test("the compression alert stops telling a reject operator the entry will save", () => {
  // It said "The entry will save without it." On a C (Reject) that is FALSE,
  // and false in the worst direction: told to carry on, refused at Save for a
  // photo they did attach, the operator's way out is to type grade B — the
  // exact corruption the rule exists to prevent.
  assert.ok(!/will save without it\.["'`]\s*\)/.test(photoField),
    "neither alert may end with the unconditional promise — PhotoField knows the slot's status");
  assert.match(photoField, /status === "required"/,
    "the alert must branch on the status the slot was given");
  assert.match(photoField, /take a NEW photo|Take a NEW photo/i,
    'owner, 2026-09-04: "Give a prompt to the user to take a new photo"');
  assert.match(photoField, /closer|less in frame/i,
    "and say how to make one that fits — a defect filling the frame compresses far smaller than a whole bay");
  // BOTH alerts in that branch, not only the first.
  assert.equal((photoField.match(/alert\(tail\(/g) ?? []).length, 2,
    "the shrink failure and the attach failure both promised the save would proceed");
});

// ─── THE THIRD DOOR ─────────────────────────────────────────────────────────
// createVerifiedSlab (the "Add & verify slab" flow off the batch screen) writes
// polish_qc directly, renders no photo field anywhere in its tree, and pre-fills
// its values off a neighbouring slab — so a reject could arrive already selected
// and be saved with one tap and zero photographs. Two write paths were guarded
// and this third one was missed for a day; a reviewer demonstrated the insert.
// The owner's ruling (2026-09-04) is that it refuses the GRADE rather than
// asking for photos it cannot carry: "Dont let it add c grade slabs. Instead
// prompt the user saying you can only add non-c grade slabs; if you really want
// to add c grade slabs either do it from tables or from the qc form."
const batchActions = src("app/batch/slabs/actions.ts");

test("the third door refuses a reject ON THE SERVER, not only in its form", () => {
  const body = batchActions.slice(batchActions.indexOf("export async function createVerifiedSlab("));
  const guard = body.indexOf("rejectGradeNotHere(");
  const create = body.indexOf(".create({");
  assert.ok(guard > 0, "createVerifiedSlab does not call rejectGradeNotHere — the third door is open again");
  assert.ok(create > 0, "createVerifiedSlab no longer creates? this test needs rewriting");
  assert.ok(guard < create,
    "the reject guard must run BEFORE the insert — a refusal after the row exists is not a refusal");
  assert.match(batchActions, /import \{[^}]*rejectGradeNotHere[^}]*\} from "@\/lib\/photoSlots"/,
    "the guard must come from lib/photoSlots, not a second spelling of the rule");
});

test("the refusal names both screens that CAN take a reject", () => {
  // A refusal that only says no leaves the operator stuck at the batch screen.
  assert.match(REJECT_GRADE_NOT_HERE_MESSAGE, /Not graded yet/i, "must say what to add it as here");
  assert.match(REJECT_GRADE_NOT_HERE_MESSAGE, /Polish QC/i, "must name the QC entry form");
  assert.match(REJECT_GRADE_NOT_HERE_MESSAGE, /Tables/i, "must name the tables editor");
});

// ─── THE SPELLINGS THAT SLIPPED ─────────────────────────────────────────────
// isRejectGrade took the head as `.trim().toUpperCase().split(/[^A-Z0-9]/)[0]`,
// which yields "" — not "C" — whenever the first character is not an ASCII
// letter or digit. Three spellings got past the entire rule that way.
test("a reject is caught however it is spelled, and CTS still is not", () => {
  for (const g of ["C", "C (Reject)", " c ", "c (reject)", "C-Reject", "C/Reject", "C_reject",
                   "\u200bC", "\uff23", "(C) Reject", "-C", "\tC (Reject)\n"])
    assert.equal(isRejectGrade(g), true, `${JSON.stringify(g)} must be caught — it renders as a C`);
  for (const g of ["CTS", "cts", "CTS (cut)", "SAMPLE", "Printing", "A", "A2", "B",
                   "Not graded yet", "", "  ", "CT", null, undefined])
    assert.equal(isRejectGrade(g), false, `${JSON.stringify(g)} must NOT be caught`);
});

// ─── ONE PHOTO RULE, TWO SIDES ──────────────────────────────────────────────
// The screens' submit guards checked only "a file is attached" while the server
// checked three conditions, so a small file with a non-image MIME passed on
// screen and was refused by the action — the operator refused for a photo they
// HAD attached. On a live line the way out of a form that will not save is to
// type a different grade, which is what the whole rule exists to prevent.
test("the screens apply the SAME photo conditions the server does", () => {
  const file = (bytes: number, type: string) =>
    new File([new Uint8Array(bytes)], "p.jpg", { type });
  assert.equal(photoProblem(file(10, "image/jpeg"), "far photo"), null, "a real photo passes");
  assert.ok(photoProblem(file(0, "image/jpeg"), "far photo"), "empty is refused");
  assert.ok(photoProblem(file(10, ""), "far photo"), "no MIME is refused");
  assert.ok(photoProblem(file(10, "text/plain"), "far photo"), "not an image is refused");
  assert.ok(photoProblem(file(10, "image/svg+xml"), "far photo"), "SVG is refused");
  assert.ok(photoProblem(file(10, "image/svg+xml;charset=utf-8"), "far photo"), "SVG with a charset too");
  assert.ok(photoProblem(null, "far photo"), "absent is refused");
  for (const s of [entryForm, tablesEditor]) {
    assert.match(s, /photoProblem\(fd\.get\(p\.field\), p\.label\)/,
      "a QC screen is judging attachment its own way again — it must ask photoProblem");
    assert.doesNotMatch(s, /f instanceof File && f\.size > 0/,
      "the size-only test is back; that is the mismatch that refuses a photo the operator attached");
  }
});

// ─── THE FOURTH DOOR: A TIDY-UP JOB MUST NOT DECIDE A SLAB WAS REJECTED ─────
// automations-dedup merges a deleted duplicate's non-null fields into the kept
// row. For every field but one that is a recovery; for the GRADE, when the value
// is a reject, it MANUFACTURES a verdict on a row that had none — and with no
// photographs, because the older row's entry_photo rows are keyed to the id this
// same pass deletes. After the three human paths were closed it was the only way
// left to get a reject in without the pair.
//
// THESE RUN THE DECISION. The first attempt matched the module's source text
// with regexes, which is the weakness a reviewer named on this rule's sibling:
// such a test passes with the logic inverted. mergeFromOlder was lifted into an
// import-free module precisely so it can be driven with real values.
const W = ["qualityGrade", "design", "slabThickness", "inspector"];
const merge = (keep: Record<string, unknown>, older: Record<string, unknown>[]) =>
  mergeFromOlder(keep, older, W);

test("an empty field is recovered from the duplicate about to be deleted", () => {
  const r = merge({ design: null, inspector: null }, [{ design: "Carrara Cloud", inspector: "Ravi" }]);
  assert.deepEqual(r.data, { design: "Carrara Cloud", inspector: "Ravi" });
  assert.equal(r.rejectGradesRefused, 0);
});

test("a field the kept row already has is never overwritten", () => {
  const r = merge({ design: "Simply White" }, [{ design: "Carrara Cloud" }]);
  assert.deepEqual(r.data, {}, "the newest row's own value wins — the merge only FILLS");
});

test("a reject grade is refused, and counted", () => {
  for (const g of ["C", "C (Reject)", "c (reject)", " c ", "​C", "Ｃ"]) {
    const r = merge({ qualityGrade: null }, [{ qualityGrade: g }]);
    assert.deepEqual(r.data, {}, `${JSON.stringify(g)} must not be merged onto a row with no verdict`);
    assert.equal(r.rejectGradesRefused, 1, "a refusal must be counted, or the run is silent");
  }
});

test("every other grade still merges — the guard is not a blanket ban", () => {
  for (const g of ["A", "A2", "B", "CTS", "SAMPLE", "Printing", "Not graded yet"]) {
    const r = merge({ qualityGrade: null }, [{ qualityGrade: g }]);
    assert.deepEqual(r.data, { qualityGrade: g }, `${g} is not a reject and must be recovered`);
    assert.equal(r.rejectGradesRefused, 0);
  }
});

test("refusing the grade does not cost the row its other fields", () => {
  // The bug this guards against is a `continue` that skips the whole duplicate:
  // the dedupe would quietly stop recovering design, thickness and inspector,
  // which is its actual job.
  const r = merge({ qualityGrade: null, design: null, slabThickness: null },
                  [{ qualityGrade: "C (Reject)", design: "Aureate", slabThickness: "2 cm" }]);
  assert.deepEqual(r.data, { design: "Aureate", slabThickness: "2 cm" });
  assert.equal(r.rejectGradesRefused, 1);
});

test("only the GRADE is guarded — a remark that looks like a C still merges", () => {
  // THE NARROWING IS LOAD-BEARING AND THIS IS THE TEST THAT PROVES IT. Drop the
  // `f === REJECT_GRADE_FIELD &&` clause and the guard goes field-agnostic:
  // every writable field whose value merely LOOKS like a C is refused and
  // miscounted as a reject. Not hypothetical — 24 live polish_qc rows carry a
  // remarks value that isRejectGrade() matches, and every one is a shipping
  // note, not a verdict: 'C/o' (care of) x6, 'C/O' x2, 'C/N' x2, 'C/P', 'C/v',
  // 'C/0', 'C/o PH', 'C/o CN P/p', 'C/O MPH', 'C/o P/H', 'C/o P/D', 'C/o PD',
  // 'c/o' — 17 distinct spellings, scanned over all 48,490 rows on 2026-09-04.
  const W2 = ["qualityGrade", "remarks", "design"];
  for (const note of ["C/o", "C/O", "C/N", "c/o", "C/o P/H", "C/0"]) {
    const r = mergeFromOlder({ qualityGrade: null, remarks: null, design: null },
                             [{ qualityGrade: "A", remarks: note, design: "Costa" }], W2);
    assert.deepEqual(r.data, { qualityGrade: "A", remarks: note, design: "Costa" },
      `${JSON.stringify(note)} is a shipping note in the remarks column, not a reject verdict`);
    assert.equal(r.rejectGradesRefused, 0, "a remark must never be counted as a refused grade");
  }
  // And the same string IN THE GRADE COLUMN is still refused, so the narrowing
  // is what distinguishes them — not the value.
  const g = mergeFromOlder({ qualityGrade: null }, [{ qualityGrade: "C/o" }], W2);
  assert.deepEqual(g.data, {}, "in the grade column that same value IS a reject spelling");
  assert.equal(g.rejectGradesRefused, 1);
});

test("a reject does not fall through to a kinder grade on a staler duplicate", () => {
  // Rows arrive newest-first. Reaching past a reject to take an A from an older
  // row would be inventing a verdict twice over.
  const r = merge({ qualityGrade: null }, [{ qualityGrade: "C (Reject)" }, { qualityGrade: "A" }]);
  assert.deepEqual(r.data, {}, "the grade must stay NULL, not become A");
  assert.equal(r.rejectGradesRefused, 1);
});

test("a null on the newest duplicate still reaches the next one", () => {
  const r = merge({ qualityGrade: null }, [{ qualityGrade: null }, { qualityGrade: "A2" }]);
  assert.deepEqual(r.data, { qualityGrade: "A2" }, "a null is skipped, not treated as a stop");
});

test("and a reject BEHIND a null is still caught", () => {
  const r = merge({ qualityGrade: null }, [{ qualityGrade: null }, { qualityGrade: "C (Reject)" }]);
  assert.deepEqual(r.data, {}, "the guard must survive the loop reaching the second row");
  assert.equal(r.rejectGradesRefused, 1);
});

test("the live dedupe uses this decision rather than a second copy of it", () => {
  const dedup = readFileSync(new URL("../src/lib/automations-dedup.ts", import.meta.url), "utf8");
  const code = dedup.replace(/\/\/[^\n]*/g, "");
  // PIN THE CALL AND THE USE OF ITS RESULT. Asserting only the ABSENCE of one
  // expression spelling was not enough: a reviewer re-inlined the old unguarded
  // loop with the locals renamed, left the now-unused import in place, and all
  // 38 tests passed — the fourth door open again and the suite green. A
  // re-inline now has to delete an assertion rather than rename a variable.
  assert.match(code, /const merged = mergeFromOlder\(keep, older, writable\);/,
    "the dedupe no longer calls the decision that is under test");
  assert.match(code, /const data = merged\.data;/,
    "the decision is called but its result is not what gets merged");
  // And the counter must be ACCUMULATED, not merely declared and returned:
  // deleting the += made every run report 0 forever, which is the exact silence
  // the counter exists to prevent, and the old assertion still passed.
  assert.match(code, /rejectGradesNotMerged \+= merged\.rejectGradesRefused/,
    "refusals are no longer added up — the run reports 0 however many it refused");
  assert.doesNotMatch(code, /data\[[a-zA-Z]+\] = [a-zA-Z]+\[[a-zA-Z]+\]/,
    "a merge loop has been inlined again, whatever its variables are called");
});

// ─── AND THE PHOTO THAT WAS BEING THROWN AWAY ───────────────────────────────
// Completing an auto-added placeholder returned "ok" straight after the update,
// while createRow's only photo store sits at the end of the function — so the
// photo an operator attached was discarded and they were shown the same green
// "Saved" as anyone else. Live for the five press-line stations.
test("completing a placeholder keeps its photo, like any other create", () => {
  // The BRANCH, not the import at the top of the file. And comments stripped,
  // because the branch's own comment quotes the old `return "ok"` — a raw search
  // finds the PROSE and reports the fix as broken.
  const i = actions.indexOf("startsWith(AUTOFILL_PREFIX)");
  assert.ok(i > 0, "the placeholder branch has moved; find it before trusting this test");
  // BOUNDED BY THE BRANCH, NOT BY A CHARACTER COUNT. This was `slice(i, i + 1800)`
  // and a nine-line comment added later pushed `return photoWarn` outside the
  // window, failing a test about code that had not changed. A fixed-width slice
  // is a test that breaks when someone writes a paragraph.
  const end = actions.indexOf("catch (e) {", i);
  assert.ok(end > i, "the branch's closing catch has moved; find it before trusting this test");
  const branch = actions.slice(i, end).replace(/\/\/[^\n]*/g, "");

  // PIN THE ARGUMENTS. Substring positions alone did not guard this: a reviewer
  // rewrote the call as storePhotos(new FormData(), model, dupe.id, ...) — the
  // original bug restored in full, the operator's photo discarded, a green
  // "Saved" shown — and every test still passed. Keying it to a nonexistent
  // record id passed too. It must be THE POSTED FORM, stored against THE ROW
  // BEING OVERWRITTEN.
  assert.match(branch, /storePhotos\(fd, model, dupe\.id,/,
    "the placeholder's photo must come from the posted form and be keyed to the row it completes");

  // And nothing may return between the update and the store, or the photo is
  // dropped exactly as it was before.
  const upd = branch.indexOf(".update(");
  const store = branch.indexOf("storePhotos(");
  assert.ok(upd > 0 && store > upd, "the store must follow the update");
  assert.doesNotMatch(branch.slice(upd, store), /return /,
    "something returns between the update and the photo store — the attachment is discarded again");

  const ret = branch.indexOf("return photoWarn");
  assert.ok(ret > store, "the success return must come after the store, not before it");
  assert.match(branch, /PHOTO_WARN_PREFIX/,
    "a store failure here must warn like the ordinary create does, not show a green tick");
});

// ─── THE UNLINKED SWEEP: A ROW WITH NO LINK IS NOT AUTOMATICALLY JUNK ───────
// The dedupe was ported as "removes unlinked QC rows", on the Airtable-era
// assumption that a QC row with no polish-entry link is a stray. Measured on
// live Neon 2026-09-04 that assumption is false on all 14,647 of them: 13,252
// carry a real verdict, 491 are graded C (Reject), 4,913 carry quality issues,
// 14,562 carry an R&W or repolish status, 251 of the database's 256 QC
// photographs hang off them, and ZERO are actually empty. entry_photo has no
// foreign key to polish_qc, so those photographs would be orphaned rather than
// cascaded — unreachable and undeletable through the app.
test("the unlinked sweep deletes only rows that carry nothing", () => {
  const dedup = readFileSync(new URL("../src/lib/automations-dedup.ts", import.meta.url), "utf8");
  const code = dedup.replace(/\/\/[^\n]*/g, "");
  // The delete must take the FILTERED list, never the raw one. This is the
  // whole fix: `[...qcDelete, ...unlinked]` was a mass deletion of the QC record.
  assert.match(code, /const allQc = \[\.\.\.qcDelete, \.\.\.unlinkedEmpty\];/,
    "the unlinked sweep is deleting the unfiltered list again — 14,647 rows of real inspection data");
  assert.doesNotMatch(code, /\[\.\.\.qcDelete, \.\.\.unlinked\]/,
    "the raw unlinked list must never reach a deleteMany");
  // Every signal that makes a row worth keeping must be consulted.
  for (const signal of ["qualityGrade", "qualityIssue", "remarks", "rwStatus", "repolishStatus"])
    assert.ok(code.includes(signal),
      `the keep-test no longer looks at ${signal} — a row carrying it would be deleted`);
  // NOT just that entry_photo is queried — that the ANSWER is used. Deleting the
  // `&& !unlinkedPhotoIds.has(id)` clause leaves the query sitting there
  // untouched, and an assertion on the query alone stays green while 251
  // photographs are orphaned.
  assert.match(code, /entry_photo/, "the photo lookup is gone");
  assert.match(code, /!unlinkedPhotoIds\.has\(id\)/,
    "the photo lookup runs but its answer is not used — a row with photographs would still be deleted");
  assert.match(code, /qcUnlinkedKept/,
    "a run must report what it declined to delete, or the restraint is invisible");
});

test("'Not graded yet' is treated as ungraded, not as a verdict worth keeping", () => {
  // This plant spells ungraded as the literal string far more often than NULL
  // (3,654 rows against 194), so a keep-test that only checked for null would
  // treat every one of those as carrying a verdict and never delete anything —
  // right answer, wrong reason, and it would hide a real regression later.
  const dedup = readFileSync(new URL("../src/lib/automations-dedup.ts", import.meta.url), "utf8");
  assert.match(dedup, /const NOT_GRADED = "Not graded yet";/);
  assert.match(dedup.replace(/\/\/[^\n]*/g, ""), /!==\s*NOT_GRADED/,
    "the keep-test must exclude 'Not graded yet' explicitly, not rely on a null check");
});
