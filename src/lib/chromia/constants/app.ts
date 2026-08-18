/** Application-wide constants. */

/**
 * Every Chromia screen, re-rooted under /chromia when the module was mounted
 * inside the ERP. Nothing in the module hardcodes a path — it reads it here —
 * so this object is the single place the mount point is written down.
 */
export const APP_ROUTES = {
  home: '/chromia',
  dashboard: '/chromia/dashboard',
  operator: '/chromia/operator',
  slabs: '/chromia/slabs',
  slabIntake: '/chromia/slabs/new',
  stockyard: '/chromia/stockyard',
  recalibrations: '/chromia/recalibrations',
  recalibrationTracking: '/chromia/recalibration-tracking',
  import: '/chromia/import',
  reports: '/chromia/reports',
  downloads: '/chromia/downloads',
} as const;

export const API_ROUTES = {
  reportExport: '/api/chromia/reports/export',
  exports: '/api/chromia/exports',
} as const;

export const PAGINATION = {
  defaultPage: 1,
  defaultPageSize: 25,
  maxPageSize: 200,
} as const;

export const DATE_FORMATS = {
  date: 'dd MMM yyyy',
  dateTime: 'dd MMM yyyy, HH:mm',
  time: 'HH:mm',
  iso: 'yyyy-MM-dd',
} as const;

/** Server-side cache tags used with `revalidateTag`. */
export const CACHE_TAGS = {
  slabs: 'slabs',
  dashboard: 'dashboard',
  reports: 'reports',
} as const;
