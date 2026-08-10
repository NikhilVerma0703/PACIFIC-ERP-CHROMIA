// pdfjs-dist ships types for its main entry point but not for the worker
// module, which the finance pipeline imports on purpose.
//
// WHY THE WORKER IS IMPORTED AT ALL: in Node, pdf.js disables the real web
// worker and loads the worker's message handler by a RELATIVE path
// ("./pdf.worker.mjs"), resolved at runtime. That path does not survive
// bundling or file tracing. Assigning the module to `globalThis.pdfjsWorker`
// before the first getDocument() makes pdf.js use the already-loaded handler
// and never attempt that import. See src/lib/finance/pipeline.ts.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
