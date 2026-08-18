/**
 * Swipe navigation — the arithmetic, kept away from the DOM.
 *
 * The module is used almost entirely on 10–12" Android tablets, where the tab
 * strip is a row of small targets at the top of a screen held in two hands.
 * Swiping the page sideways, the way a photo gallery works, moves between the
 * top-level sections without aiming at anything.
 *
 * Everything here is pure so the thresholds can be tested without a browser:
 * getting them wrong is what makes a gesture feel either dead or trigger-happy.
 */

export const SWIPE = {
  /** How far a finger must travel before the gesture counts at all. */
  minDistance: 64,
  /**
   * A swipe is horizontal only if it is clearly more sideways than up: a
   * thumb travelling down a long table drifts sideways by tens of pixels.
   */
  directionRatio: 1.5,
  /** Past this the finger is dragging, not flicking, and nothing happens. */
  maxDuration: 900,
  /** A short flick still counts if it is fast, however short. */
  flickVelocity: 0.55,
  flickDistance: 36,
  /** The page follows the finger at this fraction, so the drag feels damped. */
  drag: 0.32,
  /** …and never further than this, whatever the finger does. */
  maxDrag: 110,
  /** At the first and last section the page barely moves — a wall, not a bug. */
  edgeResistance: 0.22,
} as const;

export type SwipeDirection = 'next' | 'previous';

export interface SwipeSection {
  href: string;
  title: string;
}

/**
 * Which section a path belongs to.
 *
 * `/slabs/new` sits under `/slabs`, so the longest matching href wins — the
 * same rule the tab strip uses to decide which tab is lit.
 */
export function sectionIndex(sections: readonly SwipeSection[], pathname: string): number {
  let best = -1;
  let bestLength = -1;

  sections.forEach((section, index) => {
    const matches = pathname === section.href || pathname.startsWith(`${section.href}/`);
    if (matches && section.href.length > bestLength) {
      best = index;
      bestLength = section.href.length;
    }
  });

  return best;
}

/**
 * The section a swipe would land on, or null at the ends.
 *
 * Left takes you forward, right takes you back — the page moves with the
 * finger, exactly like a gallery. Deliberately no wrap-around: an operator who
 * swipes past the last section and lands on the first has lost their place.
 */
export function neighbourSection(
  sections: readonly SwipeSection[],
  pathname: string,
  direction: SwipeDirection,
): SwipeSection | null {
  const current = sectionIndex(sections, pathname);
  if (current === -1) return null;

  const target = direction === 'next' ? current + 1 : current - 1;
  return sections[target] ?? null;
}

export interface Gesture {
  /** Positive = finger moved right. */
  dx: number;
  dy: number;
  elapsedMs: number;
}

/** Left is "next", right is "previous". */
export function swipeDirection(dx: number): SwipeDirection {
  return dx < 0 ? 'next' : 'previous';
}

/** Is this a horizontal gesture at all, rather than a scroll or a tap? */
export function isHorizontal({ dx, dy }: Pick<Gesture, 'dx' | 'dy'>): boolean {
  return Math.abs(dx) > Math.abs(dy) * SWIPE.directionRatio;
}

/**
 * Does this gesture commit to a page change?
 *
 * Two ways to qualify: a deliberate drag past `minDistance`, or a quick flick —
 * short but fast. Without the second, a confident operator's flick does nothing
 * and the whole feature reads as broken.
 */
export function shouldNavigate({ dx, dy, elapsedMs }: Gesture): boolean {
  if (elapsedMs <= 0 || elapsedMs > SWIPE.maxDuration) return false;
  if (!isHorizontal({ dx, dy })) return false;

  const distance = Math.abs(dx);
  if (distance >= SWIPE.minDistance) return true;

  const velocity = distance / elapsedMs;
  return distance >= SWIPE.flickDistance && velocity >= SWIPE.flickVelocity;
}

/**
 * How far the page follows the finger.
 *
 * Damped, capped, and almost frozen when there is nowhere to go — the page
 * saying "this is the end" is worth more than a hard stop, which just reads as
 * a missed touch.
 */
export function dragOffset(dx: number, hasTarget: boolean): number {
  const factor = hasTarget ? SWIPE.drag : SWIPE.drag * SWIPE.edgeResistance;
  const limit = hasTarget ? SWIPE.maxDrag : SWIPE.maxDrag * SWIPE.edgeResistance;
  const damped = dx * factor;

  return Math.max(-limit, Math.min(limit, damped));
}
