import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // entry-form photo attachments ride along in server-action form posts
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  // pdfmake/pdfkit load binary assets (data.trie) at import time — must stay
  // external to the webpack bundle; puppeteer is an optional runtime dep.
  // pdfjs-dist must stay external too: the finance pipeline loads its LEGACY
  // build plus the worker module by package specifier, and webpack bundling
  // rewrites those paths in ways pdf.js's own fake-worker loader cannot follow.
  serverExternalPackages: ["pdfmake", "puppeteer", "pdfjs-dist"],
  // pin the tracing root so the stray lockfile in the user folder is ignored
  outputFileTracingRoot: __dirname,
  // fieldmap.json is read at runtime by the table layer and the automations modules.
  //
  // pdfjs-dist is listed in serverExternalPackages, so webpack never bundles it
  // and the lambda must find it in node_modules at runtime. It is reached ONLY
  // through a dynamic import() of a legacy-build path, and Vercel's file tracer
  // does not reliably follow that into the function — the module is simply not
  // there, and the import rejects.
  //
  // SCOPED TO THE FAB PO ROUTES ON PURPOSE, not "/**". Finance reads PDFs
  // through the same library, but it is working as its owners expect and a
  // global include would silently change it: pdfTextLayers() currently catches
  // this failure and falls back to OCR, so making the load succeed there would
  // alter which path every invoice takes. That is a decision for whoever owns
  // finance, not a side effect of fixing fabrication.
  //
  // Only the two legacy .mjs files are forced in, not the whole build directory:
  // the source maps beside them are several megabytes and are never loaded.
  outputFileTracingIncludes: {
    "/**": ["./scripts/fieldmap.json"],
    "/api/fab/manager/pos/**": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
};

export default nextConfig;
