import { describe, expect, it } from 'vitest';

import { MAX_RECALIBRATION_ATTEMPTS, RECALIBRATION_OVERDUE_DAYS } from '@/lib/chromia/constants/process-stages';
import { daysBetween } from '@/lib/chromia/utils/dates';
import {
  receiveFromRecalibrationSchema,
  restartAfterRecalibrationSchema,
  sendForRecalibrationSchema,
} from '@/lib/chromia/validation/recalibration';

const UUID = '3f6d2b1e-2f2a-4f2e-9c3a-1b2c3d4e5f60';

/** Mirrors the ceiling check in recalibration-service.sendForRecalibration. */
function canSend(recalibrationCount: number, isOut: boolean) {
  if (isOut) return false;
  return recalibrationCount < MAX_RECALIBRATION_ATTEMPTS;
}

describe('recalibration attempt ceiling', () => {
  it('allows attempts one through five', () => {
    for (let used = 0; used < MAX_RECALIBRATION_ATTEMPTS; used += 1) {
      expect(canSend(used, false)).toBe(true);
    }
  });

  it('refuses a sixth attempt', () => {
    expect(canSend(MAX_RECALIBRATION_ATTEMPTS, false)).toBe(false);
  });

  it('refuses sending a slab that is already out', () => {
    expect(canSend(1, true)).toBe(false);
  });
});

describe('ageing', () => {
  const sent = new Date('2026-05-03T09:00:00Z');

  it('counts whole days out', () => {
    expect(daysBetween(sent, new Date('2026-05-03T20:00:00Z'))).toBe(0);
    expect(daysBetween(sent, new Date('2026-05-09T09:00:00Z'))).toBe(6);
  });

  it('never returns a negative age', () => {
    expect(daysBetween(sent, new Date('2026-05-01T09:00:00Z'))).toBe(0);
  });

  it('flags overdue past the threshold', () => {
    const days = daysBetween(sent, new Date('2026-05-20T09:00:00Z'));
    expect(days).toBeGreaterThan(RECALIBRATION_OVERDUE_DAYS);
  });
});

describe('recalibration input validation', () => {
  it('requires a reason when sending', () => {
    expect(sendForRecalibrationSchema.safeParse({ slabId: UUID }).success).toBe(false);
    expect(sendForRecalibrationSchema.safeParse({ slabId: UUID, reason: '   ' }).success).toBe(
      false,
    );
    expect(
      sendForRecalibrationSchema.safeParse({ slabId: UUID, reason: 'Roller Mark' }).success,
    ).toBe(true);
  });

  it('accepts a reason nobody has used before', () => {
    // The field is typed as well as picked, so a new defect must not be
    // rejected just because it is not in the seeded list.
    const parsed = sendForRecalibrationSchema.safeParse({
      slabId: UUID,
      reason: 'Conveyor Scuff',
    });
    expect(parsed.success && parsed.data.reason).toBe('Conveyor Scuff');
  });

  it('treats blank dates as "now"', () => {
    const parsed = sendForRecalibrationSchema.safeParse({
      slabId: UUID,
      reason: 'Roller Mark',
      sentDate: '',
    });
    expect(parsed.success && parsed.data.sentDate).toBeUndefined();
  });

  it('rejects a non-positive thickness', () => {
    const parsed = receiveFromRecalibrationSchema.safeParse({
      recalibrationId: UUID,
      thicknessAfterMm: '0',
    });
    expect(parsed.success).toBe(false);
  });

  it('defaults work-accepted to true and parses the string form', () => {
    const blank = receiveFromRecalibrationSchema.safeParse({ recalibrationId: UUID });
    expect(blank.success && blank.data.workAccepted).toBe(true);
    const no = receiveFromRecalibrationSchema.safeParse({
      recalibrationId: UUID,
      workAccepted: 'false',
    });
    expect(no.success && no.data.workAccepted).toBe(false);
  });

  it('validates the restart payload', () => {
    expect(restartAfterRecalibrationSchema.safeParse({ recalibrationId: UUID }).success).toBe(true);
    expect(restartAfterRecalibrationSchema.safeParse({ recalibrationId: 'x' }).success).toBe(false);
  });
});
