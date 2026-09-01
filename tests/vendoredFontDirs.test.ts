import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { vendoredFontDirs, VENDORED_SUFFIX } from "../scripts/vendoredFontDirs.mjs";

// The 09:00 CEO report answered 500 every morning because its font directory
// was computed from import.meta.url, and webpack folds import.meta.url into a
// build-time string literal when it bundles the script into the lambda. The
// shipped bundle carried the BUILD machine's absolute path. The .ttf files were
// in the lambda; nothing looked where they were.
//
// These tests pin the property that fixes it: at least one candidate must be
// derived from the RUNTIME, which a bundler cannot fold away.

test("THE FIRST CANDIDATE COMES FROM process.cwd(), NOT FROM THE CALLER'S PATH", () => {
  const dirs = vendoredFontDirs("/some/build/container/scripts");
  assert.equal(dirs[0], path.join(process.cwd(), VENDORED_SUFFIX));
});

test("a caller path frozen to a machine that no longer exists changes nothing that matters", () => {
  // This is the shape of what shipped: a path that exists only on the machine
  // that ran the build. The marker is deliberately unmistakable, so the
  // assertion cannot pass by accident on a checkout that happens to sit under
  // a similarly-named directory.
  const frozen = vendoredFontDirs("/BUILD-CONTAINER-ONLY/scripts");
  const live = vendoredFontDirs("/var/task/scripts");
  // The runtime-derived candidates are identical either way, and come first.
  assert.deepEqual(frozen.slice(0, 4), live.slice(0, 4));
  // And the ones that DO depend on the caller are last, where they cost nothing.
  assert.ok(frozen.slice(0, 4).every((d) => !d.includes("BUILD-CONTAINER-ONLY")),
    "no build-machine path may appear among the runtime candidates");
  assert.ok(frozen.slice(4).some((d) => d.includes("BUILD-CONTAINER-ONLY")),
    "the caller path is still tried, just last");
});

test("the lambda root is named outright, in case cwd is moved", () => {
  assert.ok(vendoredFontDirs("/x").includes(path.join("/var/task", VENDORED_SUFFIX)),
    "/var/task is where a Vercel function's traced files land");
});

test("dropping the caller path entirely still yields usable candidates", () => {
  const dirs = vendoredFontDirs(undefined as unknown as string);
  assert.ok(dirs.length >= 4);
  assert.ok(dirs.every((d) => typeof d === "string" && d.endsWith(VENDORED_SUFFIX)));
});

test("the fonts are actually THERE, under one of the candidates, in this checkout", () => {
  // Guards the other half: the suffix has to match the real layout of
  // pdfjs-dist, or every candidate is well-formed and all of them are wrong.
  const found = vendoredFontDirs(path.join(process.cwd(), "scripts"))
    .find((d) => fs.existsSync(path.join(d, "LiberationSans-Regular.ttf")));
  assert.ok(found, "LiberationSans-Regular.ttf was not found under any candidate directory");
  for (const f of ["LiberationSans-Bold.ttf", "LiberationSans-Italic.ttf", "LiberationSans-BoldItalic.ttf"]) {
    assert.ok(fs.existsSync(path.join(found!, f)), `${f} missing from ${found}`);
  }
});
