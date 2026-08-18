/** Static, non-secret application metadata. */
export const siteConfig = {
  /** The module's name as it is written everywhere: in full caps. */
  name: 'CHROMIA MODULE',
  shortName: 'CHROMIA',
  description:
    'Slab lifecycle, process traceability and recalibration tracking for the Chromia production line.',
  url: '/chromia',
  company: 'Pacific Surfaces',
  version: '0.1.0',
  supportEmail: 'production@pacific-surfaces.com',
} as const;

export type SiteConfig = typeof siteConfig;
