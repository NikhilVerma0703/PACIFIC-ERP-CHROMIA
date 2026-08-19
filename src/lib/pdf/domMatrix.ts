// A 2D DOMMatrix for the Node side of pdfjs-dist, installed by us because
// pdf.js cannot install one for itself inside a Vercel lambda.
//
// WHY THIS FILE EXISTS
// --------------------
// pdf.js's display build expects the host to provide DOMMatrix. A browser
// does. Node does not, so pdf.js goes looking for one itself — this is
// pdfjs-dist 6.2.108, pdf.mjs line 15704, inside its `if (isNodeJS)` block:
//
//     const require = process.getBuiltinModule("module").createRequire(import.meta.url);
//     canvas = require("@napi-rs/canvas");
//     …
//     if (!globalThis.DOMMatrix) {
//       if (canvas?.DOMMatrix) globalThis.DOMMatrix = canvas.DOMMatrix;
//       else warn("Cannot polyfill `DOMMatrix`, rendering may be broken.");
//     }
//
// The Next.js file tracer decides what ships to the lambda by reading the
// import graph statically, and it cannot see a bare specifier handed to
// createRequire at runtime. So @napi-rs/canvas is never traced in, that block
// warns and assigns nothing, and a thousand lines later pdf.mjs runs this at
// MODULE SCOPE (line 16713):
//
//     const SCALE_MATRIX = new DOMMatrix();
//
// which throws `ReferenceError: DOMMatrix is not defined` while the module is
// still evaluating. There is no catching that from a call site — the import
// itself fails — so on Vercel neither reader could start: src/lib/fab/poPdf.ts
// reported "the PDF reader could not be started on the server" for every
// purchase order, and src/lib/finance/pipeline.ts logged the same failure and
// sent every bill down the OCR path as though it were a scan. The build was
// green throughout, because nothing about this is visible until the module is
// evaluated on a machine that has no @napi-rs/canvas.
//
// Putting this class on globalThis before that import satisfies the statement
// and lets the module finish evaluating.
//
// WHY NOT JUST DEPEND ON @napi-rs/canvas
// --------------------------------------
// Adding it to package.json does not work on its own, and that was measured
// rather than assumed: with the dependency declared, the traced file list for
// the PO import route was unchanged, because the tracer still cannot see the
// require. Shipping it takes an explicit outputFileTracingIncludes glob, which
// puts a ~34 MB Skia binary in every lambda that touches pdfjs so that one
// `new DOMMatrix()` can evaluate. Nothing on the server would use it: both
// server consumers call getTextContent() and nothing else, and the one place
// that genuinely rasterises, src/lib/ocr/pdfRaster.ts, is "use client" and
// draws on the browser's own canvas with the browser's own DOMMatrix.
//
// The trade is that this file depends on pdf.js's `if (!globalThis.DOMMatrix)`
// seam instead of on its choice of canvas package. That seam is the more
// stable of the two, but it is not a promise: if a later pdfjs wants more of
// DOMMatrix than is written here, it fails by name rather than by wrong
// number, and the answer then is to reconsider the dependency.
//
// WHAT IS DELIBERATELY NOT POLYFILLED
// -----------------------------------
//   * Path2D. pdf.js warns that it could not polyfill this too, and the
//     warning is all it costs: every `new Path2D()` in pdf.mjs is inside
//     CanvasGraphics or the annotation layer, both of which need a
//     CanvasRenderingContext2D that getTextContent never builds.
//   * navigator. Node 24 already supplies one carrying a `language`, so
//     pdf.js's own `if (!globalThis.navigator?.language)` never fires. It has
//     to be left alone: Node defines navigator as a getter-only accessor, so
//     assigning to it would throw in strict-mode ESM.
//   * OffscreenCanvas. pdf.js feature-detects it with `typeof`, so defining
//     one would switch pdf.js onto a canvas path with no backend behind it.
//     Absent is the correct state, not an omission.
//
// WHAT THIS CLASS IMPLEMENTS, AND ON WHAT EVIDENCE
// ------------------------------------------------
// Every DOMMatrix site in pdf.mjs 6.2.108, with the function it sits in:
//
//   16713  const SCALE_MATRIX = new DOMMatrix()      MODULE SCOPE  <- the crash
//   16233  new DOMMatrix(inverse)                    applyBoundingBox
//   16683  new DOMMatrix(matrix)                     getPattern
//   18090  new DOMMatrix(t).preMultiplySelf(…).translate(…).scale(…)   endText
//   18180  new DOMMatrix(t).invertSelf().multiplySelf(…)               #getScaledPath
//   18644  new DOMMatrix(group.matrix)               beginGroup
//   18705  new DOMMatrix(group.matrix)               beginGroup
//   19333  SCALE_MATRIX.a = … ; SCALE_MATRIX.d = …   rescaleAndStroke
//    6595  reads .a … .f off a matrix                Util.multiplyByDOMMatrix
//
// Only the first is on the text path, and it is the entire reason for this
// file: a run of two PDFs through getTextContent with every DOMMatrix member
// wired to a tripwire touched nothing but the no-argument constructor, and
// produced coordinates identical to a control run against the real
// @napi-rs/canvas matrix. The rest are render-only and not reachable from
// getTextContent. They are implemented anyway, because each is an ordinary 2D
// affine operation with one unambiguous answer and the lot comes to about
// forty lines — a class that computes the right number is worth more than one
// that throws. What is NOT implemented is anything outside that 2D affine
// core, and those members throw a sentence naming the boundary rather than
// returning a number this file has never been checked against.
//
// This is server-side only in practice. The guard in installPdfjsDomMatrix()
// makes it inert anywhere a real DOMMatrix already exists, which includes
// every browser, so it can never displace the platform's own.

const WHO = "[lib/pdf/domMatrix]";

const ADVICE =
  "This DOMMatrix is a 2D affine matrix installed only so pdfjs-dist can be " +
  "imported on the server for TEXT extraction (see src/lib/pdf/domMatrix.ts). " +
  "Code that needs the real thing needs a real implementation: add " +
  "@napi-rs/canvas to package.json AND an outputFileTracingIncludes entry for " +
  "it in next.config.mjs, and delete the install call.";

function unsupported(what: string): never {
  throw new Error(`${WHO} ${what} is not implemented. ${ADVICE}`);
}

/** The six numbers of a 2D affine matrix, in DOMMatrix's own a,b,c,d,e,f order. */
type Six = [number, number, number, number, number, number];

/**
 * `left × right`, both 2D affine.
 *
 * Written out rather than looped so it can be read against pdf.js's own
 * Util.transform (pdf.mjs:6593), which computes the same product on plain
 * arrays and is what the text path uses; the two agree term for term.
 */
function product(l: Six, r: Six): Six {
  return [
    l[0] * r[0] + l[2] * r[1],
    l[1] * r[0] + l[3] * r[1],
    l[0] * r[2] + l[2] * r[3],
    l[1] * r[2] + l[3] * r[3],
    l[0] * r[4] + l[2] * r[5] + l[4],
    l[1] * r[4] + l[3] * r[5] + l[5],
  ];
}

function numberAt(values: readonly unknown[], index: number, source: string): number {
  const v = values[index];
  if (typeof v !== "number") {
    throw new TypeError(`${WHO} ${source}[${index}] is ${typeof v}, expected a number.`);
  }
  return v;
}

/**
 * The a..f of anything matrix-shaped: one of ours, a real DOMMatrix, or a
 * plain DOMMatrixInit. Missing components take their identity value, which is
 * what the DOMMatrixInit dictionary defines them as.
 */
function sixOf(value: unknown, role: string): Six {
  if (value === undefined || value === null) return [1, 0, 0, 1, 0, 0];
  if (typeof value !== "object") {
    throw new TypeError(`${WHO} ${role} is ${typeof value}, expected a matrix.`);
  }
  const m = value as Record<string, unknown>;
  const identity: Six = [1, 0, 0, 1, 0, 0];
  const out = [...identity] as Six;
  (["a", "b", "c", "d", "e", "f"] as const).forEach((key, i) => {
    const v = m[key];
    if (v === undefined) return;
    if (typeof v !== "number") {
      throw new TypeError(`${WHO} ${role}.${key} is ${typeof v}, expected a number.`);
    }
    out[i] = v;
  });
  return out;
}

/**
 * A 2D affine matrix answering to the part of the DOMMatrix interface that
 * pdfjs-dist reaches. Mutable, because pdf.js writes `.a` and `.d` straight
 * onto its module-level SCALE_MATRIX.
 *
 * Named for what it is rather than `DOMMatrix`, so that a stack trace from a
 * lambda says plainly whose object this is.
 */
export class DomMatrix2D {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  /**
   * Accepts the forms pdf.js actually constructs from: nothing (identity), a
   * six-number array, or another matrix. A sixteen-number array is accepted
   * only when it describes a 2D matrix; a CSS transform string is not accepted
   * at all, because parsing one is a job this class does not do and guessing
   * would be worse than refusing.
   */
  constructor(init?: unknown) {
    if (init === undefined || init === null) return;

    if (Array.isArray(init)) {
      const values = init as unknown[];
      if (values.length === 6) {
        this.#set([
          numberAt(values, 0, "init"), numberAt(values, 1, "init"),
          numberAt(values, 2, "init"), numberAt(values, 3, "init"),
          numberAt(values, 4, "init"), numberAt(values, 5, "init"),
        ]);
        return;
      }
      if (values.length === 16) {
        // Column-major m11..m44. Every component outside the 2D sub-matrix has
        // to be the identity's, or this is a 3D transform and flattening it
        // would silently drop a dimension.
        const flat = values.map((_, i) => numberAt(values, i, "init"));
        const is2D =
          flat[2] === 0 && flat[3] === 0 && flat[6] === 0 && flat[7] === 0 &&
          flat[8] === 0 && flat[9] === 0 && flat[10] === 1 && flat[11] === 0 &&
          flat[14] === 0 && flat[15] === 1;
        if (!is2D) unsupported("a 3D matrix");
        this.#set([flat[0]!, flat[1]!, flat[4]!, flat[5]!, flat[12]!, flat[13]!]);
        return;
      }
      throw new TypeError(`${WHO} a matrix array must have 6 or 16 numbers, got ${values.length}.`);
    }

    if (typeof init === "string") unsupported("building a matrix from a CSS transform string");
    this.#set(sixOf(init, "init"));
  }

  #six(): Six {
    return [this.a, this.b, this.c, this.d, this.e, this.f];
  }

  #set(six: Six): this {
    [this.a, this.b, this.c, this.d, this.e, this.f] = six;
    return this;
  }

  /** Always true: the constructor refuses anything that is not 2D. */
  get is2D(): boolean {
    return true;
  }

  get isIdentity(): boolean {
    return this.a === 1 && this.b === 0 && this.c === 0
      && this.d === 1 && this.e === 0 && this.f === 0;
  }

  /** `this × other`, as a new matrix. */
  multiply(other?: unknown): DomMatrix2D {
    return new DomMatrix2D(this).multiplySelf(other);
  }

  /** `this = this × other`. */
  multiplySelf(other?: unknown): this {
    return this.#set(product(this.#six(), sixOf(other, "other")));
  }

  /** `this = other × this`. The order is the whole point of the method. */
  preMultiplySelf(other?: unknown): this {
    return this.#set(product(sixOf(other, "other"), this.#six()));
  }

  translate(tx = 0, ty = 0, tz = 0): DomMatrix2D {
    return new DomMatrix2D(this).translateSelf(tx, ty, tz);
  }

  translateSelf(tx = 0, ty = 0, tz = 0): this {
    if (tz !== 0) unsupported("translation along z");
    return this.#set(product(this.#six(), [1, 0, 0, 1, tx, ty]));
  }

  /** `scaleY` defaults to `scaleX`, as the DOMMatrix interface specifies. */
  scale(scaleX = 1, scaleY?: number, scaleZ = 1, originX = 0, originY = 0, originZ = 0): DomMatrix2D {
    return new DomMatrix2D(this).scaleSelf(scaleX, scaleY, scaleZ, originX, originY, originZ);
  }

  scaleSelf(scaleX = 1, scaleY?: number, scaleZ = 1, originX = 0, originY = 0, originZ = 0): this {
    if (scaleZ !== 1 || originZ !== 0) unsupported("scaling along z");
    const sy = scaleY ?? scaleX;
    // Scaling about an origin is a translate there, the scale, and a translate
    // back — the definition, not an approximation of it.
    if (originX !== 0 || originY !== 0) this.translateSelf(originX, originY);
    this.#set(product(this.#six(), [scaleX, 0, 0, sy, 0, 0]));
    if (originX !== 0 || originY !== 0) this.translateSelf(-originX, -originY);
    return this;
  }

  inverse(): DomMatrix2D {
    return new DomMatrix2D(this).invertSelf();
  }

  /**
   * `this = this⁻¹`.
   *
   * A DELIBERATE DIVERGENCE FROM THE SPEC. A browser's DOMMatrix answers a
   * singular matrix by setting every component to NaN and clearing is2D, so
   * that a render can carry on drawing nothing. On the server there is no
   * render to carry on with and no screen to show the nothing on; a NaN would
   * simply travel into whatever asked, so this throws instead.
   */
  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0 || !Number.isFinite(det)) {
      throw new Error(`${WHO} matrix is not invertible (determinant ${det}).`);
    }
    const { a, b, c, d, e, f } = this;
    return this.#set([
      d / det, -b / det, -c / det, a / det,
      (c * f - d * e) / det, (b * e - a * f) / det,
    ]);
  }

  toString(): string {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
  }
}

// The m11..m44 names for the same six numbers. pdf.js uses a..f, but canvas
// interop code reads the m-names, and they are aliases rather than a second
// copy so the two can never disagree.
const ALIASES: Record<string, keyof Pick<DomMatrix2D, "a" | "b" | "c" | "d" | "e" | "f">> = {
  m11: "a", m12: "b", m21: "c", m22: "d", m41: "e", m42: "f",
};
for (const [alias, own] of Object.entries(ALIASES)) {
  Object.defineProperty(DomMatrix2D.prototype, alias, {
    get(this: DomMatrix2D) { return this[own]; },
    set(this: DomMatrix2D, value: number) { this[own] = value; },
    configurable: true,
  });
}

// The third dimension of a 2D matrix is not unknown — it is fixed by what "2D"
// means, so reading these is answered rather than refused. Writing one would
// make the matrix 3D, which this class does not do, so that throws instead of
// quietly dropping the value.
const THIRD_DIMENSION: Record<string, number> = {
  m13: 0, m14: 0, m23: 0, m24: 0, m31: 0, m32: 0, m33: 1, m34: 0, m43: 0, m44: 1,
};
for (const [name, value] of Object.entries(THIRD_DIMENSION)) {
  Object.defineProperty(DomMatrix2D.prototype, name, {
    get() { return value; },
    set() { unsupported(`setting DOMMatrix.${name}`); },
    configurable: true,
  });
}

// Real members of the DOMMatrix interface this class does not implement. They
// are installed as throwers rather than left off the prototype so that a
// caller gets a sentence explaining the boundary and how to move it, instead
// of "matrix.rotate is not a function" and no clue why the object is like
// this. None of them is reachable from getTextContent in pdfjs 6.2.108.
const NOT_IMPLEMENTED = [
  "rotate", "rotateSelf", "rotateAxisAngle", "rotateAxisAngleSelf",
  "rotateFromVector", "rotateFromVectorSelf",
  "skewX", "skewXSelf", "skewY", "skewYSelf",
  "flipX", "flipY", "transformPoint", "setMatrixValue",
  "toFloat32Array", "toFloat64Array",
] as const;
for (const name of NOT_IMPLEMENTED) {
  Object.defineProperty(DomMatrix2D.prototype, name, {
    value: () => unsupported(`DOMMatrix.${name}()`),
    writable: true,
    configurable: true,
  });
}

/**
 * Put a DOMMatrix on globalThis if — and only if — there is not one already.
 *
 * Call this immediately before `import("pdfjs-dist/legacy/build/pdf.mjs")`.
 * Later is too late: the statement that needs it runs while that module is
 * evaluating.
 *
 * Idempotent, and it never displaces an existing implementation: in a browser,
 * or in a Node process that does have @napi-rs/canvas loaded, the platform's
 * own matrix stays. The reverse is also worth knowing — once this is
 * installed, pdf.js's own `if (!globalThis.DOMMatrix)` sees it and will not
 * install @napi-rs/canvas's matrix even where that package IS present. That is
 * correct for the two text-only server consumers and irrelevant to the browser
 * rasteriser, which never reaches this code, but it is the reason the members
 * above throw loudly rather than approximating.
 */
export function installPdfjsDomMatrix(): void {
  if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix !== "undefined") return;
  (globalThis as Record<string, unknown>).DOMMatrix = DomMatrix2D;
}
