---
name: kling-no-native-audio
description: Always generate Kling videos with enable_audio=false; Shyam does not want native audio.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fcc002c7-3b57-40f5-a9f8-57c4b82bbf37
  modified: 2026-09-11T12:22:21.615Z
---

When generating video with the Kling MCP (`text_to_video`, `image_to_video`), always pass `enable_audio: "false"`. Stated 2026-09-11 as a standing preference: "From next time remove native audio."

**Why:** The clips are used as silent B-roll/reels for Pacific Surfaces marketing, where music and edit are added later. Kling's generated audio is unusable in that pipeline and would have to be stripped anyway.

**How to apply:** Set `enable_audio: "false"` in the `arguments` array on every Kling generation without asking. Only turn it on if Shyam explicitly requests sound for a specific clip. Related: [[kling-mcp-setup]].
