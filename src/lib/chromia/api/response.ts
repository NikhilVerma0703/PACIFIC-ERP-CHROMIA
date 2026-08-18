import { NextResponse } from 'next/server';

import { toAppError } from '@/lib/chromia/errors';
import type { ApiErrorBody, ApiSuccessBody, PaginationMeta } from '@/lib/chromia/types/api';

/**
 * Uniform API envelope. Every Route Handler in Phase 2 responds through these
 * helpers so clients can rely on one shape for success and one for failure.
 */

export function apiSuccess<T>(data: T, init?: { status?: number; meta?: PaginationMeta }) {
  const body: ApiSuccessBody<T> = {
    success: true,
    data,
    ...(init?.meta ? { meta: init.meta } : {}),
  };
  return NextResponse.json(body, { status: init?.status ?? 200 });
}

export function apiError(error: unknown) {
  const appError = toAppError(error);
  const body: ApiErrorBody = {
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
    },
  };
  return NextResponse.json(body, { status: appError.status });
}
