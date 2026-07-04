"use client";
// Optional photo attachment for entry forms — opens the tablet/phone camera.
// Rides along in the form post as "__photo"; saved best-effort with the record.
export function PhotoField() {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
        Photo <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">optional</span>
      </span>
      <input
        type="file"
        name="__photo"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && f.size > 8 * 1024 * 1024) {
            alert("Photo is larger than 8 MB — please retake or pick a smaller one. The entry will save without it.");
            e.target.value = "";
          }
        }}
        className="block w-full text-xs text-gray-600 file:mr-2 file:rounded-lg file:border-0 file:bg-brand/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-brand"
      />
    </label>
  );
}
