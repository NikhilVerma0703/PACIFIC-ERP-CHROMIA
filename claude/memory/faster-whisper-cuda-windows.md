---
name: faster-whisper-cuda-windows
description: faster-whisper on this Windows box needs the pip CUDA DLLs on PATH; os.add_dll_directory does not work.
metadata: 
  node_type: memory
  type: reference
  originSessionId: d60f482a-4991-4af2-896c-eed443332540
  modified: 2026-09-15T06:15:31.221Z
---

To run `faster-whisper` on the GPU (RTX 5090) here: `pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"`, then put those DLL folders on **PATH** before launching Python:

```
NV=~/AppData/Roaming/Python/Python314/site-packages/nvidia
export PATH="$NV/cublas/bin:$NV/cudnn/bin:$NV/cuda_nvrtc/bin:$PATH"
```

**Why:** `os.add_dll_directory()` is NOT enough — CTranslate2 resolves `cublas64_12.dll` through its own loader and still fails with "Library cublas64_12.dll is not found or cannot be loaded", even though the model itself constructs fine. The failure surfaces only on the first `transcribe()` call, not at load, which makes it look like a model bug.

**How to apply:** set PATH in the same shell command that runs the script. Large-v3 with `word_timestamps=True` then runs fine. Pass the domain vocabulary via `initial_prompt` — it fixed real mishears (brand names, "Engineered quartz" vs "coordinate quartz").
