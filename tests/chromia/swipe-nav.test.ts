import { describe, expect, it } from 'vitest';

import { navigation } from '@/lib/chromia/config/navigation';
import {
  dragOffset,
  isHorizontal,
  neighbourSection,
  sectionIndex,
  shouldNavigate,
  SWIPE,
  swipeDirection,
  type SwipeSection,
} from '@/lib/chromia/swipe-nav';

const SECTIONS: SwipeSection[] = navigation.map(({ href, title }) => ({ href, title }));

describe('which section the swipe starts from', () => {
  it('finds each top-level section by its own path', () => {
    expect(sectionIndex(SECTIONS, '/chromia/dashboard')).toBe(0);
    expect(SECTIONS[sectionIndex(SECTIONS, '/chromia/slabs')]?.title).toBe('Slab Records');
    expect(SECTIONS[sectionIndex(SECTIONS, '/chromia/stockyard')]?.title).toBe('Stockyard');
  });

  it('keeps a child page inside its own section', () => {
    // /slabs/new is Slab Intake, which lives under Slab Records.
    expect(SECTIONS[sectionIndex(SECTIONS, '/chromia/slabs/new')]?.href).toBe('/chromia/slabs');
    expect(SECTIONS[sectionIndex(SECTIONS, '/chromia/recalibration-tracking/abc')]?.href).toBe(
      '/chromia/recalibration-tracking',
    );
  });

  it('does not mistake one section for another that starts the same way', () => {
    // "/recalibration-tracking" must not be read as "/recalibrations".
    expect(SECTIONS[sectionIndex(SECTIONS, '/chromia/recalibration-tracking')]?.title).toBe(
      'Recal. Tracking',
    );
  });

  it('answers -1 for a path outside the menu', () => {
    expect(sectionIndex(SECTIONS, '/nowhere')).toBe(-1);
  });
});

describe('where a swipe lands', () => {
  it('goes forward on a left swipe and back on a right one', () => {
    expect(swipeDirection(-80)).toBe('next');
    expect(swipeDirection(80)).toBe('previous');
  });

  it('moves one section at a time, in menu order', () => {
    expect(neighbourSection(SECTIONS, '/chromia/dashboard', 'next')?.href).toBe('/chromia/operator');
    expect(neighbourSection(SECTIONS, '/chromia/operator', 'next')?.href).toBe('/chromia/slabs');
    expect(neighbourSection(SECTIONS, '/chromia/slabs', 'previous')?.href).toBe('/chromia/operator');
  });

  it('carries a child page to its section’s neighbour', () => {
    expect(neighbourSection(SECTIONS, '/chromia/slabs/new', 'next')?.href).toBe('/chromia/stockyard');
  });

  it('stops at both ends rather than wrapping around', () => {
    const first = SECTIONS[0]?.href as string;
    const last = SECTIONS[SECTIONS.length - 1]?.href as string;

    expect(neighbourSection(SECTIONS, first, 'previous')).toBeNull();
    expect(neighbourSection(SECTIONS, last, 'next')).toBeNull();
  });

  it('does nothing from a page that is not a section', () => {
    expect(neighbourSection(SECTIONS, '/nowhere', 'next')).toBeNull();
  });

  it('reaches every section by swiping from the first to the last', () => {
    const visited = [SECTIONS[0]?.href];
    let at = SECTIONS[0]?.href as string;

    for (let step = 0; step < SECTIONS.length; step += 1) {
      const next = neighbourSection(SECTIONS, at, 'next');
      if (!next) break;
      at = next.href;
      visited.push(at);
    }

    expect(visited).toEqual(SECTIONS.map((section) => section.href));
  });
});

describe('what counts as a swipe', () => {
  it('takes a deliberate horizontal drag', () => {
    expect(shouldNavigate({ dx: -120, dy: 10, elapsedMs: 300 })).toBe(true);
  });

  it('takes a short, fast flick', () => {
    expect(shouldNavigate({ dx: -45, dy: 5, elapsedMs: 70 })).toBe(true);
  });

  it('ignores a thumb travelling down a long table', () => {
    // Scrolling drifts sideways; that must never turn the page.
    expect(shouldNavigate({ dx: -50, dy: 220, elapsedMs: 400 })).toBe(false);
    expect(isHorizontal({ dx: 30, dy: 30 })).toBe(false);
  });

  it('ignores a tap and a slow drag', () => {
    expect(shouldNavigate({ dx: -4, dy: 2, elapsedMs: 90 })).toBe(false);
    expect(shouldNavigate({ dx: -50, dy: 4, elapsedMs: 1500 })).toBe(false);
  });

  it('needs real distance when the gesture is slow', () => {
    expect(shouldNavigate({ dx: -40, dy: 4, elapsedMs: 600 })).toBe(false);
    expect(shouldNavigate({ dx: -SWIPE.minDistance, dy: 4, elapsedMs: 600 })).toBe(true);
  });
});

describe('how far the page follows the finger', () => {
  it('damps the movement rather than tracking the finger one to one', () => {
    expect(dragOffset(-200, true)).toBeLessThan(0);
    expect(Math.abs(dragOffset(-200, true))).toBeLessThan(200);
  });

  it('never travels further than the cap', () => {
    expect(Math.abs(dragOffset(-2000, true))).toBeLessThanOrEqual(SWIPE.maxDrag);
    expect(Math.abs(dragOffset(2000, true))).toBeLessThanOrEqual(SWIPE.maxDrag);
  });

  it('barely moves at the ends, so the edge is felt and not guessed', () => {
    expect(Math.abs(dragOffset(-300, false))).toBeLessThan(Math.abs(dragOffset(-300, true)));
    expect(Math.abs(dragOffset(-2000, false))).toBeLessThanOrEqual(
      SWIPE.maxDrag * SWIPE.edgeResistance,
    );
  });

  it('follows the direction of travel', () => {
    expect(dragOffset(-100, true)).toBeLessThan(0);
    expect(dragOffset(100, true)).toBeGreaterThan(0);
    expect(dragOffset(0, true)).toBe(0);
  });
});
