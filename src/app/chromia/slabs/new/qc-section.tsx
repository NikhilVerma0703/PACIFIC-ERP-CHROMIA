'use client';

import { useState } from 'react';

import { ComboInput } from '@/components/chromia/ui/combo';

import { Field } from '@/components/chromia/ui';
import { DispositionBadge, GradeBadge } from '@/components/chromia/ui/status';
import { DISPOSITION_LABELS, GRADE_ALLOWED_DISPOSITIONS } from '@/lib/chromia/constants/process-stages';
import { Disposition, SlabGrade } from '@/lib/chromia/constants/process-stages';

import { Divider, field, FieldGrid, OutcomePanel, selectField } from './ui';

export interface Option {
  id: string;
  name: string;
}

interface Props {
  recalibrationReasons: Option[];
  today: string;
  errors?: Record<string, string[] | undefined>;
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
 * The allowed outcomes come from `GRADE_ALLOWED_DISPOSITIONS`, the same table
 * the server validates against — the dropdown can never offer something the
 * service would reject.
 *
 * Choosing an outcome writes it into Slab Remarks, which is how the paper
 * register works. Recalibration writes "RECALIBRATE - <reason>" instead, once
 * a reason is picked.
 */
export function QcSection({ recalibrationReasons, today, errors }: Props) {
  const [grade, setGrade] = useState<string>('');
  const [disposition, setDisposition] = useState<string>('');
  const [remarks, setRemarks] = useState('');
  const [reasonName, setReasonName] = useState('');

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
    // Auto-fill the remark with the chosen outcome. Recalibration is filled
    // from the reason instead, once one is picked.
    setRemarks(
      value && value !== Disposition.RECALIBRATION
        ? DISPOSITION_LABELS[value as keyof typeof DISPOSITION_LABELS]
        : '',
    );
  }

  /** "RECALIBRATE - Roller Mark" — the reason is now typed or picked by name. */
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

      {/* ----------------------------------------------------- dispatch --- */}
      {disposition === Disposition.DISPATCH ? (
        <OutcomePanel title="Dispatch">
          <FieldGrid>
            <Field label="Dispatch Date" htmlFor="dispatchDate" hint="Blank = today">
              <input
                id="dispatchDate"
                name="dispatchDate"
                type="date"
                defaultValue={today}
                className={field}
              />
            </Field>
          </FieldGrid>
        </OutcomePanel>
      ) : null}

      {/* -------------------------------------------------------- stock --- */}
      {disposition === Disposition.STOCK ? (
        <OutcomePanel title="Stock">
          <FieldGrid>
            <Field label="Stock Date" htmlFor="stockDate" hint="Blank = today">
              <input
                id="stockDate"
                name="stockDate"
                type="date"
                defaultValue={today}
                className={field}
              />
            </Field>
            <Field label="Notes" htmlFor="stockNotes">
              <input id="stockNotes" name="stockNotes" className={field} />
            </Field>
          </FieldGrid>
        </OutcomePanel>
      ) : null}

      {/* ----------------------------------------------- sample cutting --- */}
      {disposition === Disposition.SAMPLE_CUTTING ? (
        <OutcomePanel title="Sample cutting">
          <FieldGrid>
            <Field label="Sample Cut Date" htmlFor="cutDate" hint="Blank = today">
              <input
                id="cutDate"
                name="cutDate"
                type="date"
                defaultValue={today}
                className={field}
              />
            </Field>
          </FieldGrid>
        </OutcomePanel>
      ) : null}

      {/* ----------------------------------------------- recalibration --- */}
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

      <Divider />

      <Field label="Slab Remarks" htmlFor="slabRemarks">
        <input
          id="slabRemarks"
          name="slabRemarks"
          className={field}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          placeholder={disposition === Disposition.RECALIBRATION ? 'RECALIBRATE - <reason>' : ''}
        />
      </Field>
    </div>
  );
}
