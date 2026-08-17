import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// A guard, not a unit test. It exists because I shipped double-encoded text to
// a live screen: a rupee sign reached production as three wrong characters, and
// a middle dot as two, across twenty places in one file.
//
// The cause was a PowerShell Get-Content / Set-Content round trip. PowerShell
// 5.1 reads a UTF-8 file as ANSI unless told otherwise and writes it back
// double-encoded, adding a BOM on the way out. Every non-ASCII character in the
// file was mangled, tsc was perfectly happy, every test passed, and the damage
// was visible only to a human looking at the rendered page.
//
// That is the whole problem: nothing in the toolchain objects. So this does.
//
// NOTE ON THIS FILE'S OWN TEXT. The damaged sequences are written below as
// escapes, never as literal characters. The first version of this guard quoted
// them in a comment as examples and then flagged itself — a detector that
// cannot describe what it detects has to be excluded from its own scan, and an
// exclusion list is how a guard stops guarding.

const ROOTS = ["src", "tests", "scripts"];
const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|css|sql|prisma)$/;
const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build"]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // a root that does not exist is not a failure
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.test(name)) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => walk(r));

/**
 * A UTF-8 lead byte that has been decoded as a single Latin-1 character,
 * followed by what its continuation byte turned into.
 *
 * Two-byte sequences (U+0080–U+07FF) lead with Â or Ã; three-byte
 * ones (which is most punctuation and every currency sign) lead with â or
 * ã. The continuation bytes land either in the Latin-1 supplement
 * ( –¿) or, for bytes 0x80–0x9F, on the Windows-1252 punctuation
 * block — which is why both ranges are here. Real prose never places one of
 * those characters immediately after the other.
 *
 * The second range matters as much as the first: an earlier draft listed only
 * the punctuation, so it caught a mangled rupee sign but would have walked
 * straight past a mangled middle dot — the commonest symptom of the very bug
 * this was written for.
 */
const MOJIBAKE = new RegExp(
  "[\\u00C2\\u00C3\\u00E2\\u00E3]" +
  "[\\u00A0-\\u00BF\\u0152\\u0153\\u0160\\u0161\\u0178\\u017D\\u017E\\u0192" +
  "\\u02C6\\u02DC\\u2013\\u2014\\u2018-\\u201E\\u2020-\\u2022\\u2026\\u2030" +
  "\\u2039\\u203A\\u20AC\\u2122]",
);

test("the source tree is not empty, so the checks below mean something", () => {
  // A guard that silently scans nothing passes forever.
  assert.ok(FILES.length > 200, `only found ${FILES.length} source files — is the walk broken?`);
});

test("no source file carries a UTF-8 byte-order mark", () => {
  // Harmless in most places, but it is the fingerprint of the same bad write,
  // and it breaks a shebang or a JSON parse the day one is added.
  const withBom = FILES.filter((f) => {
    const b = readFileSync(f);
    return b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  });
  assert.deepEqual(withBom, [], "these files begin with a BOM");
});

test("no source file contains double-encoded UTF-8", () => {
  const damaged: string[] = [];
  for (const f of FILES) {
    const text = readFileSync(f, "utf8");
    const m = MOJIBAKE.exec(text);
    if (m) {
      const line = text.slice(0, m.index).split("\n").length;
      damaged.push(`${f}:${line}`);
    }
  }
  assert.deepEqual(damaged, [],
    "double-encoded UTF-8 found. Something wrote these files as Latin-1 — " +
    "never edit source with PowerShell Set-Content; it re-encodes the whole file.");
});

test("the guard actually detects the damage it is looking for", () => {
  // Without this the regex could be quietly wrong — as it was — and every run
  // would report a clean tree. Both sequences are built from escapes so they
  // never sit in this file as real mojibake.
  // ₹ is UTF-8 E2 82 B9; read as CP1252 those three bytes become U+00E2,
  // U+201A, U+00B9. · is C2 B7, becoming U+00C2, U+00B7. Written as escapes so
  // this file stays clean under its own scan.
  const rupeeMangled = String.fromCharCode(0x00e2, 0x201a, 0x00b9);
  const midDotMangled = String.fromCharCode(0x00c2, 0x00b7);
  assert.match(rupeeMangled, MOJIBAKE, "a mangled rupee sign must be caught");
  assert.match(midDotMangled, MOJIBAKE, "a mangled middle dot must be caught");

  // And it must not fire on correct text, or the guard is unusable.
  for (const clean of ["₹161", "600 kg · Aypols", "in-time — out-time", "café", "Ω 5%"]) {
    assert.doesNotMatch(clean, MOJIBAKE, `false positive on ${JSON.stringify(clean)}`);
  }
});

test("the characters this codebase actually uses still decode", () => {
  // The positive half: prove the scan is reading correctly-encoded text rather
  // than passing because everything in range happens to be ASCII.
  const all = FILES.map((f) => readFileSync(f, "utf8")).join("");
  for (const [name, ch] of [["rupee", "₹"], ["middle dot", "·"], ["em dash", "—"]] as const) {
    assert.ok(all.includes(ch), `no ${name} anywhere — the sample is not representative`);
  }
});
