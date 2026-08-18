/**
 * Feature flags.
 *
 * Lets Phase 2+ work merge to main behind a switch instead of living on a
 * long-running branch.
 */
export const features = {
  /** Slab intake, stage progression and process event capture. */
  slabLifecycle: false,
  /** Quality check and grade decision screens. */
  qualityControl: false,
  /** Recalibration send / receive tracking and cycle limits. */
  recalibration: false,
  /** Real-time stage and location dashboards. */
  realtimeDashboard: false,
  /** Reporting and analytics exports. */
  reporting: false,
  /** Inngest-driven notifications and SLA alerts. */
  notifications: false,
} as const;

export type FeatureFlag = keyof typeof features;

export function isEnabled(flag: FeatureFlag): boolean {
  return features[flag];
}
