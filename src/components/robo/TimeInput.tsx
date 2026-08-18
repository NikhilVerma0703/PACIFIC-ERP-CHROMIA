"use client";
import { isValidTime, maskTimeInput, normaliseTime } from "@/lib/robo/time";

/**
 * Typed time entry, 24-hour HH:MM.
 *
 * Replaces `<input type="time">` on the robo entry form. The native picker
 * costs a tablet operator several taps per slab — and a slab carries four
 * times (In, Out, and a delay's From/To), logged while the line is running.
 * Typing "0930" is one motion; spinning a wheel is not.
 *
 * The value handed back is the same "HH:MM" string the picker produced, so
 * nothing downstream — durations, exports, reports — changes. The masking and
 * validation rules are pure functions in @/lib/robo/time so they can be
 * tested without a DOM.
 */
export function TimeInput({
  value, onChange, className = "", disabled, required,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const invalid = value.trim() !== "" && !isValidTime(value);
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      placeholder="HH:MM"
      value={value}
      disabled={disabled}
      required={required}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(maskTimeInput(e.target.value))}
      onBlur={(e) => onChange(normaliseTime(e.target.value))}
      className={className}
      /* Inline rather than a Tailwind class: appending "border-red-400" to a
         class string that already sets "border-gray-300" does not reliably
         win, and a half-typed time has to be unmissable on a bright shop
         floor. */
      style={invalid ? { borderColor: "#ef4444", backgroundColor: "#fef2f2" } : undefined}
    />
  );
}
