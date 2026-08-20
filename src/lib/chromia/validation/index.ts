/**
 * Barrel for the module's zod schemas.
 *
 * Deliberately empty. It re-exported `slabIntakeSchema` — one field, the fully
 * printed date — which is gone along with the separate intake page it belonged
 * to; see the note in ./slab.ts. Nothing in the app or the tests imports from
 * here (every caller reaches for the specific file), so the file is kept as the
 * place a future shared export would go rather than deleted and re-added.
 */

export {};
