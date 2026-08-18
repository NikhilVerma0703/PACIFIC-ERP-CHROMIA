'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import {
  dragOffset,
  isHorizontal,
  neighbourSection,
  SWIPE,
  shouldNavigate,
  swipeDirection,
  type SwipeSection,
} from '@/lib/chromia/swipe-nav';

/** Controls that own a horizontal drag of their own. */
const IGNORED = 'input, textarea, select, [contenteditable], [data-no-swipe]';

/**
 * Can this element still scroll sideways in the direction the finger is going?
 *
 * A wide table inside `overflow-x-auto` must scroll under the finger, not turn
 * the page. Once it has reached its own edge, though, the gesture belongs to
 * the page again — which is exactly how a gallery inside a gallery behaves.
 */
function absorbsScroll(start: EventTarget | null, container: HTMLElement, dx: number): boolean {
  let node = start instanceof Element ? start : null;

  while (node && node !== container) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowX)) {
        const maxScroll = node.scrollWidth - node.clientWidth;
        // dx < 0 is a leftward swipe, which scrolls content to the right.
        const room = dx < 0 ? maxScroll - node.scrollLeft : node.scrollLeft;
        if (room > 1) return true;
      }
    }
    node = node.parentElement;
  }

  return false;
}

/**
 * Swipe navigation for the whole application.
 *
 * Wraps the page body. A horizontal swipe moves to the next or previous
 * top-level section; the tab strip stays exactly as it was, because a swipe is
 * a shortcut, not a replacement — the operator still needs to be able to jump
 * straight to Downloads.
 *
 * Written against the DOM rather than React state on purpose: a re-render for
 * every `touchmove` cannot keep up with a finger, and the page would stutter on
 * the one class of device this exists for.
 */
export function SwipeNav({
  sections,
  children,
}: {
  sections: readonly SwipeSection[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);

  /**
   * A swipe is in flight. Held in a ref, not a local, because it is set while
   * the gesture commits and cleared only once the new section has landed — two
   * different renders. Keeping it in the listener's closure meant it latched on
   * after the first swipe and every later one was ignored.
   */
  const navigatingRef = useRef(false);

  // Kept in a ref so the listeners never need re-attaching.
  const latest = useRef({ pathname, sections });
  latest.current = { pathname, sections };

  /** Both neighbours are prefetched, so a committed swipe lands instantly. */
  useEffect(() => {
    for (const direction of ['next', 'previous'] as const) {
      const target = neighbourSection(sections, pathname, direction);
      if (target) router.prefetch(target.href);
    }
  }, [router, pathname, sections]);

  useEffect(() => {
    const container = containerRef.current;
    const surface = surfaceRef.current;
    const hint = hintRef.current;
    if (!container || !surface || !hint) return;

    let startX = 0;
    let startY = 0;
    let startedAt = 0;
    let tracking = false;
    let locked = false;

    const settle = (transition: string, offset: number) => {
      surface.style.transition = transition;
      surface.style.transform = offset === 0 ? '' : `translate3d(${offset}px,0,0)`;
    };

    const clearHint = () => {
      hint.style.opacity = '0';
    };

    const reset = () => {
      tracking = false;
      locked = false;
      settle('transform 220ms cubic-bezier(0.22,1,0.36,1)', 0);
      clearHint();
    };

    const onStart = (event: TouchEvent) => {
      if (navigatingRef.current || event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;

      const target = event.target;
      if (target instanceof Element && target.closest(IGNORED)) return;

      startX = touch.clientX;
      startY = touch.clientY;
      startedAt = event.timeStamp;
      tracking = true;
      locked = false;
    };

    const onMove = (event: TouchEvent) => {
      if (!tracking || navigatingRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!locked) {
        // Wait until the gesture has declared itself before committing to it.
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;

        if (!isHorizontal({ dx, dy }) || absorbsScroll(event.target, container, dx)) {
          tracking = false;
          return;
        }
        locked = true;
      }

      const target = neighbourSection(
        latest.current.sections,
        latest.current.pathname,
        swipeDirection(dx),
      );

      surface.style.transition = 'none';
      surface.style.transform = `translate3d(${dragOffset(dx, target !== null)}px,0,0)`;

      if (target && Math.abs(dx) > 24) {
        hint.textContent = target.title;
        hint.style.opacity = '1';
      } else {
        clearHint();
      }
    };

    const onEnd = (event: TouchEvent) => {
      if (!tracking || navigatingRef.current) {
        reset();
        return;
      }

      const touch = event.changedTouches[0];
      if (!touch) {
        reset();
        return;
      }

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const elapsedMs = event.timeStamp - startedAt;

      const direction = swipeDirection(dx);
      const target = shouldNavigate({ dx, dy, elapsedMs })
        ? neighbourSection(latest.current.sections, latest.current.pathname, direction)
        : null;

      if (!target) {
        reset();
        return;
      }

      navigatingRef.current = true;
      tracking = false;
      clearHint();
      // Carry the page off in the direction of travel; the incoming section
      // fades in over it, so the change reads as one movement.
      settle('transform 170ms ease-out', direction === 'next' ? -SWIPE.maxDrag : SWIPE.maxDrag);
      router.push(target.href);
    };

    container.addEventListener('touchstart', onStart, { passive: true });
    container.addEventListener('touchmove', onMove, { passive: true });
    container.addEventListener('touchend', onEnd, { passive: true });
    container.addEventListener('touchcancel', reset, { passive: true });

    return () => {
      container.removeEventListener('touchstart', onStart);
      container.removeEventListener('touchmove', onMove);
      container.removeEventListener('touchend', onEnd);
      container.removeEventListener('touchcancel', reset);
    };
  }, [router]);

  /** A landed navigation clears the drag, whichever way it was triggered. */
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    navigatingRef.current = false;
    surface.style.transition = '';
    surface.style.transform = '';
    if (hintRef.current) hintRef.current.style.opacity = '0';
  }, [pathname]);

  return (
    <div ref={containerRef} className="swipe-area flex flex-1 flex-col">
      <div ref={surfaceRef} className="flex flex-1 flex-col will-change-transform">
        <div key={pathname} className="page-enter flex flex-1 flex-col">
          {children}
        </div>
      </div>

      {/*
       * Where the swipe is heading. It only ever appears mid-gesture, and it
       * names the section rather than pointing at it, because a label survives
       * being read at arm's length on a tablet in a lit plant.
       */}
      <div
        ref={hintRef}
        aria-hidden
        className="swipe-hint border-line surface pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border px-4 py-2 text-sm font-semibold opacity-0 shadow-[0_6px_20px_-6px_rgba(16,24,40,0.35)]"
      />
    </div>
  );
}
