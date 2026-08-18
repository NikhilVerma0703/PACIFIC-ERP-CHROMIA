'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A field you can either pick from or type into.
 *
 * A plain `select` cannot express "one of these, or something new" — and on a
 * shop floor something new turns up regularly: a material nobody has set up, a
 * design that arrived this morning, a defect the list has never seen.
 *
 * This was built on `<input list>` + `<datalist>`, which is the tidy way to do
 * it and works on a desktop browser. It does not work on the devices this
 * module actually runs on: Android Chrome shows the list inconsistently and
 * often only after a character is typed, Firefox for Android has never
 * supported it properly, and iOS Safari buries it above the keyboard. On a
 * tablet the operator tapped the field and saw nothing, which makes a
 * pick-or-type control indistinguishable from a broken one.
 *
 * So the list is ours: a plain element, filtered as you type, opening on the
 * first tap, with rows big enough for a thumb. No dependency on what the
 * browser feels like doing, and the same behaviour on every device.
 *
 * It is rendered in a portal, positioned against the input. Every card in this
 * module clips its own contents to its rounded corners, which would cut the
 * list off whenever the field sits near the bottom of one — and a list you can
 * only see four rows of is the original problem again. Escaping to the body
 * puts it above everything, wherever the field happens to be.
 *
 * The value submitted is the **name**, not an id; the server matches it against
 * what exists and creates the record only when it is genuinely new.
 */

interface Anchor {
  left: number;
  width: number;
  /** Distance from the top of the viewport, already flipped if need be. */
  top: number;
  maxHeight: number;
}

/** Room below the field, or above it if below is too tight. */
function measure(input: HTMLInputElement): Anchor {
  const rect = input.getBoundingClientRect();
  const gap = 4;
  const below = window.innerHeight - rect.bottom - gap - 8;
  const above = rect.top - gap - 8;
  const preferred = 256;

  if (below >= Math.min(preferred, 160) || below >= above) {
    return {
      left: rect.left,
      width: rect.width,
      top: rect.bottom + gap,
      maxHeight: Math.max(120, Math.min(preferred, below)),
    };
  }

  const height = Math.max(120, Math.min(preferred, above));
  return { left: rect.left, width: rect.width, top: rect.top - gap - height, maxHeight: height };
}

export function ComboInput({
  id,
  name,
  options,
  className,
  defaultValue,
  value,
  onChange,
  placeholder,
  required,
}: {
  id: string;
  name: string;
  /** The known values, offered as suggestions. */
  options: readonly string[];
  className?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /** Uncontrolled callers keep their text here; controlled ones pass it in. */
  const [inner, setInner] = useState(defaultValue ?? '');
  const text = value ?? inner;

  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const setText = (next: string) => {
    if (onChange) onChange(next);
    else setInner(next);
  };

  /**
   * What the list shows.
   *
   * Everything while the field is empty or still holds a value that was picked,
   * so a tap always opens a full list; narrowed once the operator types
   * something of their own. Matching on "contains" rather than "starts with",
   * because nobody remembers whether the design was filed as "Astral Mist 2"
   * or "2cm Astral Mist".
   */
  const query = text.trim().toLowerCase();
  const exact = options.some((option) => option.toLowerCase() === query);
  const matches =
    query === '' || exact
      ? options
      : options.filter((option) => option.toLowerCase().includes(query));

  const visible = open && matches.length > 0;

  /** Position it before the browser paints, so it never appears then jumps. */
  useLayoutEffect(() => {
    if (!visible || !inputRef.current) return;
    setAnchor(measure(inputRef.current));
  }, [visible, matches.length]);

  /** Follow the field if the page scrolls or the tablet is turned. */
  useEffect(() => {
    if (!visible) return;

    const reposition = () => {
      if (inputRef.current) setAnchor(measure(inputRef.current));
    };

    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [visible]);

  /**
   * A tap anywhere else closes the list.
   *
   * Both the field and the list are checked, because the list lives in a portal
   * and is therefore not inside the field's own element.
   */
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (inputRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const choose = (option: string) => {
    setText(option);
    setOpen(false);
    setHighlighted(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlighted((current) => {
        const next = current + step;
        if (next < 0) return matches.length - 1;
        if (next >= matches.length) return 0;
        return next;
      });
      return;
    }

    if (event.key === 'Enter' && open && highlighted >= 0) {
      const option = matches[highlighted];
      if (option) {
        // Only swallow the Enter that is choosing something; otherwise the
        // operator's Enter should submit the row, as it always has.
        event.preventDefault();
        choose(option);
      }
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        name={name}
        className={className}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setHighlighted(-1);
        }}
        onFocus={() => setOpen(true)}
        // A tap on a field that already has focus must still reopen the list,
        // which `onFocus` alone will not do.
        onPointerDown={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />

      {visible && anchor && typeof document !== 'undefined'
        ? createPortal(
            /*
             * `data-no-swipe` keeps a sideways drag inside the list from
             * turning the page: the swipe handler skips anything inside it.
             */
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              data-no-swipe
              style={{
                position: 'fixed',
                left: anchor.left,
                top: anchor.top,
                width: anchor.width,
                maxHeight: anchor.maxHeight,
              }}
              className="border-line surface z-50 overflow-y-auto overscroll-contain rounded-lg border py-1 shadow-[0_8px_24px_-8px_rgba(16,24,40,0.28),0_2px_6px_rgba(16,24,40,0.08)]"
            >
              {matches.map((option, index) => (
                <li key={option}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option === text}
                    // Pointer-down rather than click: on a touch screen the
                    // input blurs first, and a list that closes before the tap
                    // lands is a list you cannot use.
                    onPointerDown={(event) => {
                      event.preventDefault();
                      choose(option);
                    }}
                    className={`flex w-full items-center px-3.5 py-2.5 text-left text-[15px] transition-colors ${
                      index === highlighted
                        ? 'bg-brand-50 text-brand-700'
                        : option === text
                          ? 'text-brand-700 font-medium'
                          : 'hover:bg-[var(--surface-muted)]'
                    }`}
                  >
                    {option}
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </>
  );
}
