"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { nextFieldToFocus } from "@/lib/robo/advanceFocus";

/**
 * Hands the cursor to the next empty field, so a slab can be logged on a
 * tablet without a tap between every box.
 *
 * The DOM half of lib/robo/advanceFocus.ts — that module decides WHICH field,
 * this one finds them and moves the cursor. Two things trigger it:
 *
 *   Enter / the keyboard's Next key   on any field carrying `advanceProps`
 *   a complete HH:MM                  on a TimeInput given `onComplete`
 *
 * A time is the only field on this form whose end can be known: four digits
 * and the mask has a whole time. A slab number, a body weight and a remark are
 * all as long as they are, so nothing jumps out of those on its own — being
 * thrown out of a half-typed slab number would cost far more than the tap it
 * saved.
 *
 * ONLY WHERE THERE IS A TOUCH KEYBOARD. `(pointer: coarse)` rather than a
 * width breakpoint, because the question is whether the person is typing on
 * glass, not how wide the screen is — a 768px tablet and a 768px browser
 * window want opposite answers here. On a desktop nothing changes at all:
 * Enter still submits the form, as the in-charges' hands already expect.
 *
 * Fields are grouped, and the cursor never leaves its group. The slab row and
 * the delay panel below it are one HTML form, so without groups Enter on the
 * last remark would drop into the delay start time — a panel most slabs never
 * use. On a touch screen this also stops Enter inside the delay panel saving
 * the slab instead of adding the delay, which is what Enter does in a form. On
 * a desktop that is still what it does: nothing here changes for a mouse and a
 * real keyboard, deliberately, because that is where the in-charges work and
 * they submit with Enter today.
 */

const GROUP_ATTR = "data-advance-group";

export function useFieldAdvance() {
  /** Put on the <form> holding the fields; the search is scoped to it. */
  const formRef = useRef<HTMLFormElement | null>(null);
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    // Starts false so the first client render matches the server's, then
    // corrects itself. matchMedia is absent in some embedded webviews.
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const read = () => setTouch(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  const advanceFrom = useCallback((el: HTMLInputElement | null | undefined) => {
    const form = formRef.current;
    if (!form || !el) return;
    const group = el.getAttribute(GROUP_ATTR);
    if (!group) return;
    const fields = Array.from(
      form.querySelectorAll<HTMLInputElement>(`input[${GROUP_ATTR}="${CSS.escape(group)}"]`),
    );
    const from = fields.indexOf(el);
    if (from < 0) return;
    const to = nextFieldToFocus(
      fields.map((f) => ({
        value: f.value,
        // offsetParent is null for anything display:none — the Robo2 fields
        // when the run has no Roymix, for instance.
        skip: f.disabled || f.readOnly || f.offsetParent === null,
      })),
      from,
    );
    if (to === null) {
      // Nothing left to fill. Letting go drops the keyboard, which is what
      // puts the Save button back on screen.
      el.blur();
      return;
    }
    fields[to]?.focus();
  }, []);

  /**
   * Spread onto every input that should take part, e.g.
   * `{...advanceProps("slab")}`. Inputs advance within their own group only.
   */
  const advanceProps = useCallback(
    (group: string) => touch
      ? {
          [GROUP_ATTR]: group,
          enterKeyHint: "next" as const,
          onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            // Enter would otherwise submit — half a slab, or the slab instead
            // of the delay being added.
            e.preventDefault();
            advanceFrom(e.currentTarget);
          },
        }
      : { [GROUP_ATTR]: group },
    [touch, advanceFrom],
  );

  /** For TimeInput's onComplete: advance only where there is a touch keyboard. */
  const advanceOnComplete = useCallback(
    (el: HTMLInputElement) => { if (touch) advanceFrom(el); },
    [touch, advanceFrom],
  );

  return { formRef, advanceProps, advanceOnComplete };
}
