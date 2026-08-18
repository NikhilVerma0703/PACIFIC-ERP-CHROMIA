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
  // fieldmap.json is read at runtime by the table layer and the automations modules
  outputFileTracingIncludes: { "/**": ["./scripts/fieldmap.json"] },
};

export default nextConfig;
