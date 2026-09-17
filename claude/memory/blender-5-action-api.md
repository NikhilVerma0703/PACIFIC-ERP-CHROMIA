---
name: blender-5-action-api
description: "Blender 5.0 removed Action.fcurves — animation F-curves now live under action.layers[].strips[].channelbags[]."
metadata: 
  node_type: memory
  type: reference
  originSessionId: eec75d75-3e98-4bee-b900-02888de69cb0
  modified: 2026-09-15T07:43:02.671Z
---

In Blender 4.4+ (confirmed on **5.0.1**) `bpy.types.Action` no longer exposes
`.fcurves`. Reaching keyframes to set interpolation now means walking
`action.layers[] -> strips[] -> channelbags[] -> fcurves`, or
`strip.channelbag(anim_data.action_slot).fcurves` on builds that expose the
single-slot accessor.

It fails silently in a way that wastes a whole render: the script raises
`AttributeError: 'Action' object has no attribute 'fcurves'` *after* the scene is
built, so `blender --background` still exits 0 and writes zero frames.

Cheaper alternative when you only want smooth easing: set
`bpy.context.preferences.edit.keyframe_new_interpolation_type = 'BEZIER'` and
`keyframe_new_handle_type = 'AUTO_CLAMPED'` before inserting any keyframes,
and never touch the F-curves at all.

Working both-API helper: `_fcurves()` in
`C:\Users\user\Downloads\AMA-Pacific-Sarjapur\_scripts\build_scene.py`.
Used by [[ama-sarjapur-bay]].
