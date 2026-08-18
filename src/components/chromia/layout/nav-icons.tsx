/**
 * Navigation glyphs.
 *
 * Hand-written 16px stroke icons rather than an icon package — seven glyphs do
 * not justify a dependency, and these ship as part of the server render with
 * no extra client bytes.
 */

const shared = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export type NavIconName =
  | 'dashboard'
  | 'operator'
  | 'slabs'
  | 'intake'
  | 'stockyard'
  | 'recalibration'
  | 'tracking'
  | 'reports'
  | 'downloads'
  | 'import';

const PATHS: Record<NavIconName, React.ReactNode> = {
  // Grid — overview
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="3" y="15" width="7" height="6" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
    </>
  ),
  // Clipboard with a line — the shop-floor register
  operator: (
    <>
      <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z" />
      <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
      <path d="M8.5 12h7M8.5 16h4" />
    </>
  ),
  // Stacked layers — slabs
  slabs: (
    <>
      <path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
      <path d="m3.5 17 8.5 4.5 8.5-4.5" />
    </>
  ),
  // Tray with a down arrow — incoming
  intake: (
    <>
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      <path d="M12 3v10" />
      <path d="m8 9.5 4 4 4-4" />
    </>
  ),
  // Racking — slabs standing on a stock rack
  stockyard: (
    <>
      <path d="M3 5v14M21 5v14" />
      <path d="M3 12h18" />
      <path d="M7 8.5v3M11 8.5v3M15 8.5v3" />
      <path d="M7 15.5v3M11 15.5v3M15 15.5v3" />
    </>
  ),
  // Cycle — recalibration loop
  recalibration: (
    <>
      <path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9" />
      <path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9" />
      <path d="M18 2.5V7h-4.5" />
      <path d="M6 21.5V17h4.5" />
    </>
  ),
  // Route with waypoints — a slab's journey
  tracking: (
    <>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="M8.4 6H14a3.5 3.5 0 0 1 0 7h-4a3.5 3.5 0 0 0 0 7h5.6" />
    </>
  ),
  // Bars — reports
  reports: (
    <>
      <path d="M4 20h16" />
      <rect x="5" y="11" width="4" height="6" rx="1" />
      <rect x="11" y="7" width="4" height="10" rx="1" />
      <rect x="17" y="13" width="3" height="4" rx="1" />
    </>
  ),
  // Tray with a down arrow — download
  downloads: (
    <>
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      <path d="M12 3.5v11" />
      <path d="m8 10.5 4 4 4-4" />
    </>
  ),
  // Sheet with an up arrow — file import
  import: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      <path d="M12 18v-6" />
      <path d="m9.5 14 2.5-2.5 2.5 2.5" />
    </>
  ),
};

export function NavIcon({ name }: { name: NavIconName }) {
  return <svg {...shared}>{PATHS[name]}</svg>;
}

export function isNavIconName(value: string | undefined): value is NavIconName {
  return value !== undefined && value in PATHS;
}
