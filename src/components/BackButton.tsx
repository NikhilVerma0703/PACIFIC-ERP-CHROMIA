"use client";

import { useRouter } from "next/navigation";

export function BackButton({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className="mb-1 inline-flex items-center gap-1 text-sm text-brand hover:underline"
    >
      ← {label}
    </button>
  );
}
