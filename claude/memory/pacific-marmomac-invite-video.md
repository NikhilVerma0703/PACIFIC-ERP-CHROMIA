---
name: pacific-marmomac-invite-video
description: How the 40s Marmomac invite reel is built - HTML/CSS scene driven by a render(t) function, captured with puppeteer.
metadata:
  type: project
---

The Marmomac invite reel lives in `C:\Users\user\Downloads\marmomac-invite`. It is not an
After Effects project: the whole animation is one HTML page (`scene.html`) exposing
`window.render(t)`, which puppeteer (`render.js frames`) steps frame by frame and screenshots
at 1080x1920. `prep.py` stages assets, `sfx.py` synthesises the whoosh/impact/riser bed, and
ffmpeg muxes frames plus music.

Everything is locked to a beat grid measured from the track: BEAT 0.5136 s, PHASE 0.26 s,
so `bar(n) = 0.26 + n*2.0544`. Both scene.html and sfx.py hardcode those constants - change
one and you must change the other or the SFX drift off the cuts.

Two traps already hit: title type must be fitted **after** `document.fonts.ready` or Hubot
Sans metrics are wrong and headlines overflow; and several Footages clips
(Antik Finish, Water Jet Finish, Finishes Video Updated) have burned-in captions and logos
that have to be cropped or avoided. See [[marmomac-2026-stand]].
