// Where Liberation Sans might be, asked of the RUNTIME rather than the build.
//
// Its own file for the reason approvalKey and slabIntakeDigestText are their
// own files: nothing here imports Prisma, pdfmake or anything else, so a test
// can load it. make-daily-report-pdf.mjs opens a PrismaClient at import time
// and could never be reached from `node --test`, which is exactly why the bug
// below shipped untested.
//
// THE BUG. This list used to be a single path built from import.meta.url. Next
// bundles the PDF script into the daily-email lambda, and webpack replaces
// import.meta.url with a build-time STRING LITERAL - the shipped bundle read:
//
//     fileURLToPath("file:///C:/Users/user/Desktop/ERP/scripts/make-daily-report-pdf.mjs")
//
// On Vercel that froze to the build container's /vercel/path0/scripts/...,
// so the fonts resolved to /vercel/path0/node_modules/... while the lambda
// runs from /var/task. The module threw "No usable fonts found" at import,
// and the 09:00 report answered 500 every morning before it reached the
// database or the mail server. The .ttf files were in the lambda the whole
// time, traced to <lambda root>/node_modules/pdfjs-dist/standard_fonts/.
//
// Hence the rule this file enforces: THE FIRST CANDIDATE MUST COME FROM
// process.cwd(). A bundler cannot fold that away, and for a Next server
// function on Vercel cwd IS the lambda root the trace is laid out against.
import path from "node:path";

export const VENDORED_SUFFIX = path.join("node_modules", "pdfjs-dist", "standard_fonts");

/**
 * @param {string} here  the directory of the calling module, for the
 *                       unbundled cases. Pass path.dirname(fileURLToPath(
 *                       import.meta.url)) - it is allowed to be wrong.
 */
export function vendoredFontDirs(here) {
  const dirs = [
    // What a Vercel lambda actually has. This one fires in production.
    path.join(process.cwd(), VENDORED_SUFFIX),
    // The lambda root named outright, should cwd ever move.
    path.join("/var/task", VENDORED_SUFFIX),
    // A pnpm or monorepo layout hoists node_modules above the app.
    path.join(process.cwd(), "..", VENDORED_SUFFIX),
    path.join(process.cwd(), "..", "..", VENDORED_SUFFIX),
  ];
  // Run from a shell, unbundled: the repo root above scripts/, and scripts/
  // itself. Last, because when this is bundled they are the wrong machine.
  if (here) dirs.push(path.join(here, "..", VENDORED_SUFFIX), path.join(here, VENDORED_SUFFIX));
  return dirs;
}
