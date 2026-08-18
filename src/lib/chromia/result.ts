/**
 * Result type for operations that are expected to fail as part of normal
 * business flow (validation, rule violations) — reserving thrown exceptions
 * for genuinely exceptional conditions.
 */
import { type AppError } from './errors';

export type Ok<T> = { readonly ok: true; readonly data: T };
export type Err<E = AppError> = { readonly ok: false; readonly error: E };
export type Result<T, E = AppError> = Ok<T> | Err<E>;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err<E = AppError>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.data;
  throw result.error;
}
