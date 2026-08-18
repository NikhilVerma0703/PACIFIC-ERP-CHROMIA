/**
 * Application navigation tree.
 *
 * Kept as data (not JSX) so it can be filtered by role, rendered by any shell,
 * and unit-tested. `icon` names resolve against `components/layout/nav-icons`.
 */
export interface NavItem {
  /** Visible label. */
  title: string;
  /** App Router path. */
  href: string;
  /** Glyph name, resolved at render time. */
  icon?: string;
  /** Roles allowed to see this entry; undefined means "everyone signed in". */
  roles?: readonly string[];
  children?: readonly NavItem[];
}

/**
 * Slab Intake is deliberately absent.
 *
 * The form is not a place you visit; it is what opens when you click a slab
 * that still needs finishing. Leaving it in the menu invited someone to open a
 * blank one and type a slab the operator had already entered. The route is
 * unchanged — only the way in is.
 */
export const navigation: readonly NavItem[] = [
  { title: 'Dashboard', href: '/chromia/dashboard', icon: 'dashboard' },
  { title: 'Operator Entry', href: '/chromia/operator', icon: 'operator' },
  { title: 'Slab Records', href: '/chromia/slabs', icon: 'slabs' },
  { title: 'Stockyard', href: '/chromia/stockyard', icon: 'stockyard' },
  { title: 'Recalibration', href: '/chromia/recalibrations', icon: 'recalibration' },
  { title: 'Recal. Tracking', href: '/chromia/recalibration-tracking', icon: 'tracking' },
  { title: 'Summary', href: '/chromia/reports', icon: 'reports' },
  { title: 'Downloads', href: '/chromia/downloads', icon: 'downloads' },
  { title: 'Import', href: '/chromia/import', icon: 'import' },
];
