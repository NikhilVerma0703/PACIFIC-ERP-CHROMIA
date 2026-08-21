"use client";

import { useRouter } from "next/navigation";

/**
 * Back to wherever they actually were.
 *
 * router.back() rather than a link to a computed "previous" page: the refused
 * navigation replaced nothing, so the entry behind this one is the page they
 * were reading, whatever it was. A Link cannot know that.
 *
 * WHY THERE IS A FALLBACK, which is the whole point of this component.
 *
 * A refusal is not always reached from another page in the app. Open a link to
 * /tables from WhatsApp, or middle-click it into a new tab, and the gate's 302
 * REPLACES the pending entry rather than adding one - so the tab's history is
 * exactly one entry long and history.back() has nowhere to go. The button did
 * nothing at all, on the page whose entire job is to explain what happened.
 *
 * Same guard as components/BackButton.tsx, which already learned this.
 *
 * It is a button and not an <a>, because there is no href that means "back" -
 * and a plain <a href="#"> would leave a dead anchor in the address bar for
 * anyone who middle-clicks it.
 */
export function GoBack({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90"
    >
      Go back
    </button>
  );
}
