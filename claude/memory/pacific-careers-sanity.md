---
name: pacific-careers-sanity
description: "How job openings must be structured in Sanity for the Pacific Surfaces careers page, and why pasting a whole JD breaks it."
metadata: 
  node_type: memory
  type: reference
  originSessionId: c9627918-88f2-4fd9-9d7a-6ab1633929e5
  modified: 2026-08-25T10:29:34.582Z
---

The careers page at https://pacific-surfaces.com/careers is fed by Sanity project
`zg1p4qgs`, dataset `production`, doc type `jobOpening` (Studio at
https://pacific-surfaces.com/studio/structure/jobOpening). The dataset is
publicly readable, so job content can be inspected via the GROQ API without auth;
writes need a logged-in Studio session or an Editor token.

Field contract — getting this wrong is what breaks the page:

- `description` is a **short summary only** (~150–280 chars, 1–2 plain sentences).
  The site renders it in a single `<p>`, so newlines collapse. Pasting a full JD
  here makes every Word `•` float inline mid-sentence and blows the card up.
- `responsibilities` is a **separate array of plain strings**, one sentence each.
  This is what renders as the Key Responsibilities bullet list. If it is empty the
  card shows no bullets at all.
- `order` (int) drives sort position; docs without it fall to the bottom in
  arbitrary order. Convention: heads 5–7, zonal 10–13, managers 15–18,
  associates 20–22, trainees 30–31.
- `visible` (bool) hides a role without deleting it.
- Multi-city roles are **one document per city**, all sharing the same `order`;
  the page groups them into a single card with several location chips.

Two gotchas that cost time:

- Check for **stale drafts** (`drafts.<id>`) before patching. A leftover draft
  carrying the old bad content will silently re-break the doc if anyone hits
  Publish. Query with `perspective=raw` to see them.
- The page is Next.js ISR on Vercel with `X-Nextjs-Stale-Time: 300`, so the live
  site lags Sanity by up to ~5 minutes after a write. Verify against the rendered
  DOM, not the HTML source — `&` is entity-escaped there, which gives false
  negatives on grep.

Source JDs live in `C:\Users\user\Downloads\Profiles` as .docx.
