import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // CACHE HEADERS FOR THE PWA ASSETS - the single biggest bandwidth cut
  // available without touching any logic. Next serves public/ files with
  // max-age=0, must-revalidate, so every floor tablet re-asked for the same
  // icons and manifest on every visit: production logs showed ~20,000 such
  // requests in 48 hours (manifest 6,986; icon-512-maskable 5,796; icon-192
  // 4,177...), each one ALSO an edge middleware invocation. The icons never
  // change without a filename change, so a year + immutable is correct; the
  // manifest gets a day, because its contents could change on a deploy and a
  // stale manifest holds the old icon list until it expires.
  async headers() {
    return [
      {
        source: "/:file(icon-192.png|icon-512.png|icon-512-maskable.png|apple-touch-icon.png|logo-white.png|logo-dark.png)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      // SECURITY HEADERS ON EVERY RESPONSE. None of these change what a page
      // does; each one only closes a door nothing in this app walks through.
      // Vercel stamps them at the edge, so there is no runtime cost.
      //
      //  - nosniff: every binary route (entry photos, bill images, invoices,
      //    PDFs) already sends an explicit Content-Type, so the browser never
      //    needed to guess; this just forbids it from guessing anyway.
      //  - X-Frame-Options SAMEORIGIN, deliberately NOT DENY: FinanceBills.tsx
      //    shows a split PDF page through an <object> pointing at our own
      //    /api/office/finance route, and Chromium applies this header to
      //    <object>/<embed> as well as frames - DENY would blank the bill
      //    viewer. Nothing frames the ERP from another origin, so SAMEORIGIN
      //    keeps the viewer and shuts out clickjacking.
      //  - Referrer-Policy: an ERP URL carries batch numbers, order ids and
      //    ?from= paths; the rare cross-origin link (Gmail app-password help,
      //    mailto) now receives only the origin. Same-origin requests still
      //    get the full referrer, so nothing inside the app changes.
      //  - HSTS two years + subdomains: the site is HTTPS-only (middleware.ts
      //    308-redirects *.vercel.app to the canonical https host, and nothing
      //    in src calls an http:// URL); browsers ignore the header over plain
      //    http, so `next dev` on localhost is unaffected.
      //  - Permissions-Policy: camera stays (self) because PhotoField.tsx's
      //    <input type="file" capture="environment"> is how the tablets take
      //    entry photos; microphone, geolocation, payment and usb have zero
      //    callers in src (no getUserMedia, no navigator.geolocation), so
      //    they are switched off outright.
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
  reactStrictMode: true,
  // Nothing reads the X-Powered-By: Next.js header; it only tells a scanner
  // which framework to look up advisories for, and costs bytes on every response.
  poweredByHeader: false,
  // The /_next/image optimizer is switched off because nothing uses it: there
  // is not one next/image import or <Image> in src (the logos and entry photos
  // are plain <img>). Leaving it on kept an unauthenticated endpoint alive
  // (the SVG-DoS advisory GHSA-q8wf-6r8g-63ch targets exactly it) that Vercel
  // also bills separately. With no callers this is a no-op for every user.
  images: { unoptimized: true },
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
    // The scheduled daily report renders its PDF inside the function, so the
    // generator AND the fonts it reads must travel with it.
    //
    // Fonts for the same reason spelled out above: pdfjs-dist is external and
    // the tracer does not follow a runtime fs.readFileSync into it. Without
    // this the module throws "No usable fonts found" on the first cold start -
    // at 09:00, on a schedule, with nobody watching. Liberation Sans is the
    // only tier a Linux lambda can reach; Calibri and Trebuchet are the
    // Windows-only tiers that let the CLI reproduce the original document.
    "/api/report/daily-email": [
      "./scripts/make-daily-report-pdf.mjs",
      "./scripts/dailyReportData.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf",
      "./node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf",
      "./node_modules/pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf",
      "./node_modules/pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf",
    ],
  },
};

export default nextConfig;
