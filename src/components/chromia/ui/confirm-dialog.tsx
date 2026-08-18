'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Ask before something cannot be undone.
 *
 * Deliberately not the browser's own `confirm()`. That dialog blocks the whole
 * page while it is open, cannot say which slab it means in the module's own
 * words, and on an Android tablet appears at the top of the screen far from
 * the thumb that opened it. This one is part of the page: it says the slab
 * number out loud, its safe answer is the one already focused, and Escape or a
 * tap outside is a cancel.
 *
 * Rendered in a portal, above every card, so it is never clipped by the table
 * it was opened from.
 */
export function ConfirmDialog({
  open,
  title,
  detail,
  error,
  cancelLabel = 'Cancel',
  busy = false,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  /** One line under the question — what exactly is about to go. */
  detail?: string;
  /** Why the last attempt failed — shown in place, so the answer stays put. */
  error?: string;
  cancelLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  /** The confirming control — a submit button inside its own form. */
  children: React.ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  /** The safe answer holds the focus, so a stray Enter cancels. */
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      // `data-no-swipe` so a drag inside the dialog cannot turn the page under
      // it — swiping away from a confirmation is not an answer to it.
      data-no-swipe
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(15,35,64,0.45)] p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="border-line surface w-full max-w-md rounded-xl border p-6 shadow-[0_20px_48px_-12px_rgba(16,24,40,0.35)]"
      >
        <p className="text-foreground text-base font-semibold">{title}</p>
        {detail ? <p className="text-muted mt-2 text-sm">{detail}</p> : null}

        {error ? (
          <p role="alert" className="text-status-waste mt-4 text-sm">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-5 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-55"
          >
            {cancelLabel}
          </button>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
