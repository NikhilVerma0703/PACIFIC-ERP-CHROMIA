/** Shared primitive and utility types used across the application. */

export type Nullable<T> = T | null;
export type Maybe<T> = T | null | undefined;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** Branded id types keep a SlabId from ever being passed where a UserId is expected. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type ISODateString = string;

export type SortDirection = 'asc' | 'desc';

export interface SortSpec<TField extends string = string> {
  field: TField;
  direction: SortDirection;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface SelectOption<T = string> {
  label: string;
  value: T;
  disabled?: boolean;
}
