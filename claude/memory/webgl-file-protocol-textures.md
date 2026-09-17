---
name: webgl-file-protocol-textures
description: WebGL textures never load over file:// — a three.js page tested by opening the local HTML renders every textured surface black.
metadata:
  type: reference
---

Chrome treats every `file://` image as cross-origin for WebGL, so
`TextureLoader` resolves but the texture stays empty and the shader samples
black. A three.js scene opened straight off disk therefore renders **untextured
materials correctly and textured ones as pure black** — which looks exactly like
a lighting or material bug and sends you chasing the wrong thing.

Tell them apart: if flat-colour meshes light up but every mapped mesh is black,
it is the protocol, not the material.

Serve it instead:

```bash
python -m http.server 8000 --directory <folder>
```

Headless verification needs software WebGL too — plain `--headless=new` has no
GPU, so pass `--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader`
or the page falls back to its no-WebGL branch.

Hit while building the walkthrough for [[ama-sarjapur-bay]].
