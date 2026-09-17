---
name: design-democracy-bts-reel
description: "\"BTS x DESIGN DEMOCRACY - Hyderabad\" booth-build reel, v3 delivered 2026-09-17; the edit is code (render_v3.py), not an NLE project."
metadata: 
  node_type: memory
  type: project
  originSessionId: c1f28a0a-d85a-427a-85d6-3e2d6c70bfc8
  modified: 2026-09-17T12:06:44.125Z
---

The reel and everything needed to change it live in `C:\Users\user\Downloads\DesignDemocracy_BTS_Edit`.
`CONTEXT.md` §0 holds the v3 shot list, cut frames, transitions and rebuild steps. The edit is a
numpy/OpenCV frame compositor (`scripts/render_v3.py`: CUTS / SHOTS / TR tables), rendered to PNG and
muxed with ffmpeg, so revisions mean editing those tables and re-rendering (~30 s for 735 frames).

**v3 (current)** is 24.500 s: `DesignDemocracy_Hyderabad_BTS_v3.mp4`. The requester rejected v2's grade
and its "crazy transitions", so v3 has **no grade at all** (`grade()` is a pass-through — don't
reintroduce a LUT), no vignette, no grain, no film burn, and only four white flash cuts plus three match
cuts. One typeface: **Hubot Sans Regular**, white. Pacific white logo on the **end card only** — a
top-left corner mark was built and then removed on review, so don't re-add it. v2 (`render.py`, 30 s)
is kept and still builds.

Music is now the audio of `Downloads\BTS\Behind every aesthetic café reel….mp4`, used straight — already
−14.3 LUFS, so the encode adds no make-up gain. Style reference is
`Downloads\BTS\We're coming to @designdemocracy.in 2026…mp4` (a VOX teaser). Both are inputs, untouched.

**Why:** the requester wanted the reel cleaned up to match that VOX teaser — natural footage, confident
holds, flash cuts, big centred caps — rather than the frenetic v2.

**How to apply:** on any v4 request start from CONTEXT.md §0.9. Three things are open with the requester:
- the first 2.34 s is two **CC BY-SA** Wikimedia clips (Charminar, Golconda) — share-alike arguably
  attaches to the whole reel, so it should not be published as-is. See `_work\stock\LICENCES.md`, which
  also lists how to drop or replace them. Pexels and Pixabay are 403-blocked from this machine.
- the on-screen wording is the editor's: "EVERY / SURFACE", "STARTS / SOMEWHERE", "IS SET FOR", and
  "18 | 19 | 20 SEP 2026" read off the reference post rather than confirmed.
- the end card's tagline line is deliberately left empty.

Related: [[pacific-marmomac-invite-video]] (another code-rendered reel).
