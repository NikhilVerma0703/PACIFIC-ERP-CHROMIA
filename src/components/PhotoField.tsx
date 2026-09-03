"use client";
// Optional photo attachment for entry forms — opens the tablet/phone camera.
// Camera photos are 4–8 MB but Vercel rejects request bodies over ~4.5 MB,
// so we downscale + re-encode to JPEG in the browser BEFORE the form posts.
// The oversized original is removed from the input SYNCHRONOUSLY, so tapping
// Save mid-compress posts the entry without the photo (never a 413 crash).
// EXIF rotation is applied by the browser decode on Android Chrome >=81 /
// iOS Safari >=13.4 (our fleet), so the re-encoded JPEG is upright.
import { useRef, useState } from "react";
import { SINGLE_PHOTO_FIELD } from "@/lib/photoSlots";

/** What the chip beside the label says. "optional" is this component's whole
 *  history and stays the default; "required" and "on file" exist for the QC
 *  reject rule, where the pair stops being optional the moment C is picked and
 *  a photo already stored satisfies it. The CHIP is the point: the operator has
 *  to learn the requirement while filling the form, not from a refusal after
 *  they have already waited out two uploads. */
export type PhotoFieldStatus = "optional" | "required" | "onFile";
export type PhotoFieldState = "" | "busy" | "ready" | "off";

const MAX_DIM = 1920;          // longest edge after downscale
const TARGET = 2 * 1024 * 1024; // aim under 2 MB on the wire
const HARD_MAX = 3_500_000;     // never post anything bigger than this

async function toBitmap(f: File): Promise<ImageBitmap | HTMLImageElement> {
  try { return await createImageBitmap(f); } catch { /* fall through */ }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
    img.src = url;
  });
}

/** Exported for forms that carry MORE than one photo per request (slab intake's
 *  far/near pair): two photos share the same ~4.5 MB body budget, so that form
 *  passes tighter target/hardMax figures. Defaults are this file's own limits —
 *  PhotoField's behaviour is unchanged. */
export async function compressPhoto(
  f: File,
  opts: { maxDim?: number; target?: number; hardMax?: number } = {},
): Promise<File | null> {
  const maxDim = opts.maxDim ?? MAX_DIM;
  const target = opts.target ?? TARGET;
  const hardMax = opts.hardMax ?? HARD_MAX;
  const src = await toBitmap(f);
  const w = "naturalWidth" in src ? src.naturalWidth : src.width;
  const h = "naturalHeight" in src ? src.naturalHeight : src.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  if (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) src.close();
  let best: Blob | null = null;
  for (const q of [0.8, 0.65, 0.5, 0.35]) {
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && (!best || blob.size < best.size)) best = blob;
    if (blob && blob.size <= target) break;
  }
  if (!best || best.size > hardMax) return null;
  return new File([best], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

/** One optional photo input. Defaults are the single generic photo every entry
 *  form has always carried (field __photo, this file's own size limits); a form
 *  carrying the far/near PAIR passes the slot's field name and the tighter pair
 *  budget from lib/photoSlots, since two photos share one request body. */
export function PhotoField({
  field = SINGLE_PHOTO_FIELD,
  label = "Photo",
  hint,
  target = TARGET,
  hardMax = HARD_MAX,
  status = "optional",
  onState,
}: {
  field?: string;
  label?: string;
  hint?: string;
  target?: number;
  hardMax?: number;
  status?: PhotoFieldStatus;
  /** Told every time this slot changes state. A form that REFUSES to save
   *  without the photo needs to know the difference between "not attached" and
   *  "still compressing" — the second is a wait, not a mistake, and telling the
   *  operator to attach a photo they just attached is how a rule loses its
   *  credibility on the floor. */
  onState?: (s: PhotoFieldState) => void;
} = {}) {
  const [state, setRawState] = useState<PhotoFieldState>("");
  const gen = useRef(0);
  // WHAT TO DO NEXT, and it depends on whether this slot is REQUIRED.
  //
  // Until 2026-09-04 both alerts below ended "the entry will save without it".
  // On a C (Reject) slab that is FALSE — the form refuses the save and so does
  // tables/actions.ts — and it is false in the worst possible direction: the
  // operator is told to carry on, taps Save, is refused for a photo they did
  // attach, and the way out of that loop is to type grade B. That is precisely
  // the corruption the reject rule exists to prevent, produced by the sentence
  // meant to reassure them.
  //
  // So a required slot is asked for a NEW photo (owner, 2026-09-04: "Give a
  // prompt to the user to take a new photo"), and told how to make one that
  // fits: a defect filling the frame compresses far smaller than a whole bay,
  // because a JPEG's size follows the detail in it, not the subject's size.
  const tail = (what: string) =>
    status === "required"
      ? `${what} This photo is REQUIRED for a C (Reject) slab — the entry will NOT save without it. Take a NEW photo: stand closer, or with less in frame (one defect, not the whole bay), then attach it again.`
      : `${what} Retake or pick a smaller one. The entry will save without it.`;
  // The callback is read through a ref so a parent passing a fresh arrow every
  // render cannot change what this component does; every setState below is in
  // an event handler or after an await, never during render.
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const setState = (s: PhotoFieldState) => { setRawState(s); onStateRef.current?.(s); };

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const f = input.files?.[0];
    if (!f) { setState(""); return; }
    const my = ++gen.current;
    if (f.size <= 500_000) { setState("ready"); return; } // small enough as-is
    // Remove the oversized original NOW — a Save during compression must
    // post the entry without the photo rather than crash on the body limit.
    try { input.files = new DataTransfer().files; } catch { input.value = ""; }
    setState("busy");
    let use: File | null = null;
    try { use = await compressPhoto(f, { target, hardMax }); } catch { use = null; }
    if (!use && f.size <= hardMax) use = f;
    if (gen.current !== my) return; // a newer selection took over
    if (!use) {
      setState("off");
      alert(tail("Couldn't shrink this photo enough to upload."));
      return;
    }
    try {
      const dt = new DataTransfer();
      dt.items.add(use);
      input.files = dt.files;
      setState("ready");
    } catch {
      setState("off");
      alert(tail("Couldn't attach the photo on this device."));
    }
  };

  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
        {label}
        {status === "required"
          ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">required</span>
          : status === "onFile"
            ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">on file</span>
            : <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">optional</span>}
        {state === "busy" && <span className="text-[10px] text-amber-600">compressing…</span>}
        {state === "ready" && <span className="text-[10px] text-emerald-600">✓ ready</span>}
      </span>
      {hint && <span className="mb-1 block text-[11px] text-gray-400">{hint}</span>}
      <input
        type="file"
        name={field}
        accept="image/*"
        capture="environment"
        onChange={onChange}
        className="block w-full text-xs text-gray-600 file:mr-2 file:rounded-lg file:border-0 file:bg-brand/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-brand"
      />
    </label>
  );
}
