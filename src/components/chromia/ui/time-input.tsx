'use client';

import { useState } from 'react';

import { normaliseClockTime } from '@/lib/chromia/clock-time';

/**
 * A time you type, not one you scroll to.
 *
 * The browser's own time control is a spinner on a tablet. Booking a run of
 * forty slabs means forty scrolls to the minute, and correcting a time copied
 * off the paper book means scrolling to it as well. A text box takes "0915"
 * in one gesture.
 *
 * What it does beyond being a text box:
 *
 *   - offers the number keypad rather than the full keyboard;
 *   - drops the colon in for you as you type, so "0915" becomes 09:15 without
 *     reaching for a shifted key;
 *   - tidies up on the way out, so "9", "930" and "9.30" all end up written
 *     the same way in the register;
 *   - never blocks a keystroke it does not understand — a half-typed time has
 *     to be allowed to exist, and what is wrong is said by the field's own
 *     error line, not by characters silently refusing to appear.
 *
 * The value submitted is always HH:MM, 24-hour. The server checks it again;
 * this component is a convenience, never the guard.
 */
export function TimeInput({
  id,
  name,
  className,
  value,
  onChange,
  defaultValue,
  required,
  placeholder = 'HH:MM',
}: {
  id: string;
  name: string;
  className?: string;
  /** Controlled callers pass both; uncontrolled ones pass `defaultValue`. */
  value?: string;
  onChange?: (value: string) => void;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? '');
  const text = value ?? inner;

  const setText = (next: string) => {
    if (onChange) onChange(next);
    else setInner(next);
  };

  /**
   * Drop the colon in once the time is unambiguous, and not before.
   *
   * Only at four digits. Putting it in after two turns "930" — nine thirty,
   * typed the way it is said — into "93:0", which is not a time at all and
   * cannot be tidied into one. At four digits there is only one reading:
   * "0930" is half past nine and nothing else.
   *
   * Three digits are left alone and sorted out on the way out, and a colon the
   * operator typed themselves is always respected. Deleting never re-inserts,
   * or backspace could not get past the colon.
   */
  const handleChange = (next: string) => {
    const deleting = next.length < text.length;
    const cleaned = next.replace(/[^0-9:]/g, '').slice(0, 5);

    if (deleting || cleaned.includes(':')) {
      setText(cleaned);
      return;
    }

    setText(cleaned.length === 4 ? `${cleaned.slice(0, 2)}:${cleaned.slice(2)}` : cleaned);
  };

  /** On the way out, write it the way the register writes it. */
  const handleBlur = () => {
    const tidied = normaliseClockTime(text);
    if (tidied && tidied !== text) setText(tidied);
  };

  return (
    <input
      id={id}
      name={name}
      type="text"
      value={text}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
      className={className}
      required={required}
      placeholder={placeholder}
      // The numeric keypad, and none of the browser's guesses: an in-time is
      // not an address and it is not a password.
      inputMode="numeric"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      maxLength={5}
    />
  );
}
