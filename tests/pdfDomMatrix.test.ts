// Pins src/lib/pdf/domMatrix.ts — the DOMMatrix we hand pdfjs-dist before
// importing it on the server.
//
// WHAT THIS IS GUARDING AGAINST. pdf.js gets its Node DOMMatrix from
// @napi-rs/canvas through a createRequire() call the Next.js file tracer cannot
// see, so the package is not in the Vercel lambda, and a top-level
// `const SCALE_MATRIX = new DOMMatrix()` in pdf.mjs throws
// `ReferenceError: DOMMatrix is not defined` while the module is still
// evaluating. That failure is invisible to the build and invisible on any
// machine that happens to have the package installed — which is every
// developer's — so the only honest test is one that takes the package away and
// reads a real PDF anyway. That is what the last test here does.
//
// The pdfjs import is a few megabytes to evaluate and happens once, so this
// file is slower than its neighbours: about a second, still hermetic, no
// network and no database.

import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { DomMatrix2D, installPdfjsDomMatrix } from "../src/lib/pdf/domMatrix.ts";

/* -- Make the lambda's missing package missing here too ---------------------- */
//
// Done at module load, before any test runs, because pdf.js reaches for
// @napi-rs/canvas once while pdf.mjs is evaluating and never again. Local
// node_modules usually has the package (it arrives as somebody's transitive
// dependency); the lambda never does. Intercepting the CJS resolver is how the
// two are made to agree — pdf.js asks for it through createRequire(), so this
// is the same door.

const resolver = Module as unknown as {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
};
const realResolve = resolver._resolveFilename;
resolver._resolveFilename = (request: string, ...rest: unknown[]): string => {
  if (request === "@napi-rs/canvas") {
    const err = new Error("Cannot find module '@napi-rs/canvas'") as Error & { code?: string };
    err.code = "MODULE_NOT_FOUND";
    throw err;
  }
  return realResolve.call(resolver, request, ...rest);
};

/* -- The installer ----------------------------------------------------------- */

test("the installer supplies a DOMMatrix, and never displaces one that exists", () => {
  const holder = globalThis as Record<string, unknown>;
  const before = holder.DOMMatrix;
  try {
    delete holder.DOMMatrix;
    installPdfjsDomMatrix();
    assert.equal(holder.DOMMatrix, DomMatrix2D);

    // Idempotent: a second call on a globalThis this module already seeded
    // must not replace the class, or pdf.js could end up holding one instance
    // of it and our code another.
    installPdfjsDomMatrix();
    assert.equal(holder.DOMMatrix, DomMatrix2D);

    // A real implementation wins. In a browser this is the platform's own
    // matrix, and quietly overwriting it would be the worst thing this module
    // could do.
    const platform = class RealEnough {};
    holder.DOMMatrix = platform;
    installPdfjsDomMatrix();
    assert.equal(holder.DOMMatrix, platform);
  } finally {
    if (before === undefined) delete holder.DOMMatrix;
    else holder.DOMMatrix = before;
  }
});

/* -- The matrix itself ------------------------------------------------------- */

// Negative zero is folded into zero. `assert.deepEqual` compares primitives
// with Object.is, which separates the two, and a matrix component that came out
// as -0 rather than 0 is arithmetic noise, not a difference anyone can observe.
const six = (m: DomMatrix2D) =>
  [m.a, m.b, m.c, m.d, m.e, m.f].map((n) => (n === 0 ? 0 : n));

test("no argument gives the identity, which is all pdf.js's module scope asks for", () => {
  const m = new DomMatrix2D();
  assert.deepEqual(six(m), [1, 0, 0, 1, 0, 0]);
  assert.equal(m.isIdentity, true);
  assert.equal(m.is2D, true);
});

test("the six-number form, the m-names, and copying all agree", () => {
  const m = new DomMatrix2D([2, 3, 4, 5, 6, 7]);
  assert.deepEqual(six(m), [2, 3, 4, 5, 6, 7]);
  assert.equal(m.isIdentity, false);

  // Aliases, not a second copy: writing through one name is visible in the other.
  const named = m as unknown as Record<string, number>;
  assert.deepEqual(
    [named.m11, named.m12, named.m21, named.m22, named.m41, named.m42],
    [2, 3, 4, 5, 6, 7],
  );
  named.m41 = 60;
  assert.equal(m.e, 60);

  // The third dimension of a 2D matrix is known, not unknown.
  assert.equal(named.m33, 1);
  assert.equal(named.m44, 1);
  assert.equal(named.m13, 0);

  assert.deepEqual(six(new DomMatrix2D(m)), six(m));
});

test("multiplication happens in the order the method name promises", () => {
  // pdf.mjs:18090 builds a text matrix as
  //   new DOMMatrix(t).preMultiplySelf(inv).translate(x, y).scale(fs, -fs)
  // so `this × other` and `other × this` are not interchangeable here.
  const scale = new DomMatrix2D([2, 0, 0, 2, 0, 0]);
  const move = new DomMatrix2D([1, 0, 0, 1, 10, 20]);

  // this × other: the translation is scaled by the matrix on the left.
  assert.deepEqual(six(scale.multiply(move)), [2, 0, 0, 2, 20, 40]);
  // other × this: it is not.
  assert.deepEqual(six(new DomMatrix2D(scale).preMultiplySelf(move)), [2, 0, 0, 2, 10, 20]);

  // multiply() leaves both operands alone; multiplySelf() writes to the left one.
  assert.deepEqual(six(scale), [2, 0, 0, 2, 0, 0]);
  assert.deepEqual(six(move), [1, 0, 0, 1, 10, 20]);
  assert.deepEqual(six(new DomMatrix2D(scale).multiplySelf(move)), [2, 0, 0, 2, 20, 40]);
});

test("translate and scale return a new matrix; the -Self forms mutate", () => {
  const base = new DomMatrix2D([2, 0, 0, 2, 5, 5]);

  const moved = base.translate(10, 20);
  assert.deepEqual(six(moved), [2, 0, 0, 2, 25, 45]);
  assert.deepEqual(six(base), [2, 0, 0, 2, 5, 5], "translate() must not touch the receiver");

  assert.deepEqual(six(new DomMatrix2D(base).translateSelf(10, 20)), [2, 0, 0, 2, 25, 45]);

  // scaleY defaults to scaleX, and the flip pdf.js applies to text is negative.
  assert.deepEqual(six(new DomMatrix2D().scale(3)), [3, 0, 0, 3, 0, 0]);
  assert.deepEqual(six(new DomMatrix2D().scale(12, -12)), [12, 0, 0, -12, 0, 0]);

  // Scaling about an origin holds that point still.
  const aboutPoint = new DomMatrix2D().scaleSelf(2, 2, 1, 100, 50);
  assert.deepEqual(six(aboutPoint), [2, 0, 0, 2, -100, -50]);
});

test("inversion is a real inverse, and a singular matrix is refused out loud", () => {
  const m = new DomMatrix2D([2, 0, 0, 4, 30, 60]);
  // M maps (x, y) to (2x + 30, 4y + 60), so M⁻¹ maps it back with 0.5x - 15.
  assert.deepEqual(six(m.inverse()), [0.5, 0, 0, 0.25, -15, -15]);
  assert.deepEqual(six(m.inverse()), six(new DomMatrix2D(m).invertSelf()));

  // m⁻¹ × m is the identity, which is the property pdf.mjs:18180 depends on.
  const round = new DomMatrix2D(m).invertSelf().multiplySelf(m);
  for (const [i, v] of six(round).entries()) {
    assert.ok(Math.abs(v - [1, 0, 0, 1, 0, 0][i]!) < 1e-12, `component ${i} was ${v}`);
  }

  // Not the spec's silent NaN: a lambda has no screen to draw the nothing on,
  // so the number never gets to travel.
  assert.throws(
    () => new DomMatrix2D([0, 0, 0, 0, 0, 0]).invertSelf(),
    /not invertible/,
  );
});

test("what is not implemented says so, and says what to do about it", () => {
  const m = new DomMatrix2D() as unknown as Record<string, () => unknown>;
  for (const name of ["rotate", "skewX", "transformPoint", "toFloat32Array"]) {
    assert.throws(() => m[name]!(), /@napi-rs\/canvas/, `${name} should refuse by name`);
  }
  // Writing a third-dimension component would make this a 3D matrix, which it
  // is not; dropping the value quietly is the outcome worth preventing.
  assert.throws(() => { (m as unknown as Record<string, number>).m33 = 2; }, /not implemented/);
  // A sixteen-number 3D transform is refused for the same reason.
  const threeD = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1];
  assert.throws(() => new DomMatrix2D(threeD), /3D matrix/);
  // A sixteen-number array that IS 2D is fine.
  const flat2d = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 7, 8, 0, 1];
  assert.deepEqual(six(new DomMatrix2D(flat2d)), [2, 0, 0, 3, 7, 8]);
});

/* -- Both loaders must install it, and install it in time -------------------- */
//
// Checked against the source text rather than by calling the loaders, because
// neither file can be imported by `node --test`: they use extensionless
// relative imports, which Node's ESM resolver does not accept. The ordering is
// the part worth pinning — installing after the import is the same as not
// installing at all, since the statement that needs the matrix runs while
// pdf.mjs is still evaluating.

const CONSUMERS = ["src/lib/fab/poPdf.ts", "src/lib/finance/pipeline.ts"];

test("poPdf and the finance pipeline both install the matrix before importing pdf.mjs", () => {
  for (const file of CONSUMERS) {
    const source = readFileSync(file, "utf8");
    const installed = source.indexOf("installPdfjsDomMatrix();");
    const imported = source.indexOf('import("pdfjs-dist/legacy/build/pdf.mjs")');
    assert.ok(source.includes("@/lib/pdf/domMatrix"), `${file} must import the shared polyfill`);
    assert.ok(installed !== -1, `${file} must call installPdfjsDomMatrix()`);
    assert.ok(imported !== -1, `${file} should still import pdf.mjs`);
    assert.ok(installed < imported, `${file} installs the matrix after importing pdf.mjs`);
  }
});

/* -- The real thing ---------------------------------------------------------- */

/** A one-page PDF with text at known places, built the way a generator does. */
async function fixturePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("PURCHASE ORDER PS-4471", { x: 72, y: 720, size: 18, font });
  page.drawText("Calacatta Gold 3200x1600x20", { x: 140, y: 620, size: 11, font });
  page.drawText("661.33", { x: 420, y: 620, size: 11, font });
  return doc.save({ useObjectStreams: false });
}

test("with @napi-rs/canvas gone, pdfjs still imports and still reads the text", async () => {
  // The sequence loadPdfjs() uses in both consumers: worker first and
  // best-effort, then the matrix, then the main module.
  try {
    (globalThis as Record<string, unknown>).pdfjsWorker =
      await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  } catch {
    // Exactly as the consumers treat it: an optimisation, not a requirement.
  }
  installPdfjsDomMatrix();

  // Without the line above this import throws ReferenceError: DOMMatrix is not
  // defined, and that is the production failure verbatim.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as {
    getDocument: (opts: Record<string, unknown>) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[] }> }>;
        }>;
      }>;
      destroy: () => Promise<void>;
    };
  };

  assert.equal(
    (globalThis as Record<string, unknown>).DOMMatrix,
    DomMatrix2D,
    "pdf.js should have found our matrix already there and left it alone",
  );

  const task = pdfjs.getDocument({
    data: await fixturePdf(),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
  });
  try {
    const doc = await task.promise;
    assert.equal(doc.numPages, 1);
    const content = await (await doc.getPage(1)).getTextContent();
    // pdf.js emits a synthetic " " run for the horizontal gap between two runs
    // sharing a baseline. It is real output, not noise, but it is a gap rather
    // than text and carries no coordinate anyone here reads.
    const runs = content.items.filter((i) => typeof i.str === "string" && i.str.trim() !== "");

    // Not just "it did not throw". The coordinates are the product this whole
    // path exists to deliver — poParser groups runs into lines by the baseline
    // in transform[5] and into columns by the left edge in transform[4] — so
    // they are what gets asserted.
    assert.deepEqual(
      runs.map((i) => [i.str, i.transform?.[4], i.transform?.[5]]),
      [
        ["PURCHASE ORDER PS-4471", 72, 720],
        ["Calacatta Gold 3200x1600x20", 140, 620],
        ["661.33", 420, 620],
      ],
    );
  } finally {
    await task.destroy();
  }
});
