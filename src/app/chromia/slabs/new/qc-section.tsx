'use client';

import { useState } from 'react';

import { ComboInput } from '@/components/chromia/ui/combo';

import { Field } from '@/components/chromia/ui';
import { DispositionBadge, GradeBadge } from '@/components/chromia/ui/status';
import { DISPOSITION_LABELS, GRADE_ALLOWED_DISPOSITIONS } from '@/lib/chromia/constants/process-stages';
import { ChromiaDisposition as Disposition, ChromiaSlabGrade as SlabGrade } from '@prisma/client';

import { field, FieldGrid, OutcomePanel, selectField } from './ui';

export interface Option {
  id: string;
  name: string;
}

interface Props {
  recalibrationReasons: Option[];
  errors?: Record<string, string[] | undefined>;
  /** Pre-filled values when correcting an already-graded slab (the Edit path). */
  initial?: {
    grade?: string;
    disposition?: string;
    slabRemarks?: string;
    reasonName?: string;
  };
}

const GRADE_OPTIONS = [
  { value: SlabGrade.A, label: 'Grade A' },
  { value: SlabGrade.B, label: 'Grade B' },
  { value: SlabGrade.C, label: 'Grade C' },
] as const;

/**
 * QC Section.
 *
 *   Grade A → Dispatch · Stock
 *   Grade B → Stock · Sample Cutting
 *   Grade C → Recalibration
 *
 * QC decides two things and only two: the grade, and the outcome that grade
 * allows. The dates a slab is dispatched, stocked or cut are captured later, on
 * those sections' own screens, when the slab actually gets there — so nothing
 * but the grade, the outcome, and (for recalibration) its reason appears here.
 *
 * The chosen outcome is still written into the slab's remark behind the scenes,
 * the way the paper register records it, so the Slab Remarks column keeps
 * reading true without QC having to ask for anything extra.
 */
export function QcSection({ recalibrationReasons, errors, initial }: Props) {
  const [grade, setGrade] = useState<string>(initial?.grade ?? '');
  const [disposition, setDisposition] = useState<string>(initial?.disposition ?? '');
  const [remarks, setRemarks] = useState(initial?.slabRemarks ?? '');
  const [reasonName, setReasonName] = useState(initial?.reasonName ?? '');

  const allowed = grade
    ? GRADE_ALLOWED_DISPOSITIONS[grade as keyof typeof GRADE_ALLOWED_DISPOSITIONS]
    : [];

  function chooseGrade(value: string) {
    setGrade(value);
    setDisposition('');
    setRemarks('');
    setReasonName('');
  }

  function chooseDisposition(value: string) {
    setDisposition(value);
    setReasonName('');
    // The remark still mirrors the chosen outcome (Dispatch, Stock, Sample
    // cutting), the way the register does; recalibration fills it from the
    // reason instead, once one is picked.
    setRemarks(
      value && value !== Disposition.RECALIBRATION
        ? DISPOSITION_LABELS[value as keyof typeof DISPOSITION_LABELS]
        : '',
    );
  }

  /** "RECALIBRATE - Roller Mark" — the reason is typed or picked by name. */
  function chooseReason(value: string) {
    setReasonName(value);
    setRemarks(value.trim() ? `RECALIBRATE - ${value.trim()}` : '');
  }

  return (
    <div className="flex flex-col gap-6">
      <FieldGrid>
        <Field
          label="Decide Grade *"
          htmlFor="grade"
          error={errors?.grade?.[0]}
          badge={grade ? <GradeBadge grade={grade as SlabGrade} /> : undefined}
        >
          <select
            id="grade"
            name="grade"
            required
            className={selectField}
            value={grade}
            onChange={(event) => chooseGrade(event.target.value)}
          >
            <option value="" disabled>
              Select grade
            </option>
            {GRADE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Outcome *"
          htmlFor="disposition"
          error={errors?.disposition?.[0]}
          hint={grade ? undefined : 'Choose a grade first'}
          badge={
            disposition ? <DispositionBadge disposition={disposition as Disposition} /> : undefined
          }
        >
          <select
            id="disposition"
            name="disposition"
            required
            disabled={!grade}
            className={selectField}
            value={disposition}
            onChange={(event) => chooseDisposition(event.target.value)}
          >
            <option value="" disabled>
              {grade ? 'Select outcome' : '—'}
            </option>
            {allowed.map((value) => (
              <option key={value} value={value}>
                {DISPOSITION_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>

      {/* Recalibration keeps its reason — the one outcome-specific field QC
          still fills, because the reason is decided at the bench, not later.
          Dispatch, Stock and Sample cutting no longer ask for a date here; those
          are captured on their own screens when the slab actually gets there. */}
      {disposition === Disposition.RECALIBRATION ? (
        <OutcomePanel title="Recalibration">
          <FieldGrid>
            <Field
              label="Recalibrate Reason"
              htmlFor="recalibrationReason"
              error={errors?.recalibrationReason?.[0]}
            >
              <ComboInput
                id="recalibrationReason"
                name="recalibrationReason"
                options={recalibrationReasons.map((reason) => reason.name)}
                value={reasonName}
                onChange={chooseReason}
                placeholder="Pick one, or type a new reason"
                className={field}
              />
            </Field>
          </FieldGrid>
        </OutcomePanel>
      ) : null}

      {/* The chosen outcome, kept as the slab's remark the way the register
          records it — but no longer a field anyone types. QC decides only Grade
          and Outcome. */}
      <input type="hidden" name="slabRemarks" value={remarks} />
    </div>
  );
}
