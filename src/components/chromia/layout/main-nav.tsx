'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { isNavIconName, NavIcon } from '@/components/chromia/layout/nav-icons';
import type { NavItem } from '@/lib/chromia/config/navigation';
import { cn } from '@/lib/chromia/utils/cn';

/**
 * Primary navigation — raised tabs.
 *
 * `/chromia/slabs/new` must win over `/chromia/slabs` when both could match, so the longest
 * matching href is the active one.
 *
 * The active tab is drawn in the page's own white, lifted out of the blue-slate
 * strip by a soft shadow and carrying a brand bar along its top edge. Because it
 * is the same colour as the page below and has no bottom border, it reads as one
 * continuous surface with the screen — the tab is not merely marked, it is where
 * you are. Nothing else in the strip carries a background, so the eye finds the
 * current section without reading a single label.
 */
export function MainNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();

  const activeHref = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav
      aria-label="Primary"
      className="no-scrollbar -mb-px flex items-stretch gap-1 overflow-x-auto pt-1.5"
    >
      {items.map((item) => {
        const isActive = item.href === activeHref;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              // Labels are set at 14px — a shop-floor screen is read at arm's
              // length. The horizontal padding tightens to hold nine tabs on
              // one line at that size; below that width the strip scrolls.
              'group relative flex items-center gap-2 rounded-t-[10px] px-3 py-2.5 text-[14px] tracking-[-0.01em] whitespace-nowrap lg:px-3.5',
              'transition-[color,background-color,box-shadow] duration-150',
              isActive
                ? // The brand bar rides the tab's top edge as an inset shadow,
                  // so it follows the rounded corners instead of squaring them
                  // off. No border at the foot: the tab opens onto the page
                  // rather than sitting on top of it.
                  'text-brand-700 bg-[var(--surface)] font-semibold shadow-[inset_0_3px_0_var(--color-brand-600),0_1px_3px_rgba(16,24,40,0.10)]'
                : // Deliberately fainter than the active fill: a hover that
                  // reads as strongly as the current tab makes the menu
                  // ambiguous the moment the pointer crosses it.
                  'font-medium text-[var(--header-tab)] hover:text-[var(--header-fg)] hover:bg-white/70',
            )}
          >
            {isNavIconName(item.icon) ? (
              <span
                aria-hidden
                className={cn(
                  'grid size-4 shrink-0 place-items-center transition-opacity duration-150',
                  // A glyph at half strength reads as disabled rather than as
                  // merely not-current, so the idle icons carry most of their
                  // weight and only the hover step is left to do.
                  isActive ? 'opacity-100' : 'opacity-75 group-hover:opacity-100',
                )}
              >
                <NavIcon name={item.icon} />
              </span>
            ) : null}

            {item.title}

          </Link>
        );
      })}
    </nav>
  );
}
