/**
 * Result<T, E> — Railway-Oriented Programming foundation for PAI hooks.
 *
 * All hook operations return Result instead of throwing. Try/catch is confined
 * to adapter boundaries. Everything above is pure Result pipelines.
 */

// ─── Core Types ──────────────────────────────────────────────────────────────

export type Result<T, E> = Ok<T, E> | Err<T, E>;

export interface Ok<T, E> {
  readonly ok: true;
  readonly value: T;
  readonly error?: never;
}

export interface Err<T, E> {
  readonly ok: false;
  readonly value?: never;
  readonly error: E;
}

// ─── Constructors ────────────────────────────────────────────────────────────

export function ok<T, E = never>(value: T): Result<T, E> {
  return { ok: true, value };
}

export function err<T = never, E = unknown>(error: E): Result<T, E> {
  return { ok: false, error };
}

// ─── Combinators ─────────────────────────────────────────────────────────────

/** Chain a function that returns Result. Short-circuits on Err. */
export function andThen<T, E, U>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/** Transform the success value, preserving Err. */
export function map<T, E, U>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Transform the error value, preserving Ok. */
export function mapError<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** Pattern match on Result. Both branches must return the same type. */
export function match<T, E, U>(
  result: Result<T, E>,
  handlers: { ok: (value: T) => U; err: (error: E) => U },
): U {
  return result.ok ? handlers.ok(result.value) : handlers.err(result.error);
}

/** Extract value or return default on Err. */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

// ─── Collection Operations ───────────────────────────────────────────────────

/** Collect an array of Results into a Result of array. First Err short-circuits. */
export function collectResults<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
}

/** Partition results into separate ok/err arrays. Never short-circuits. */
export function partitionResults<T, E>(
  results: Result<T, E>[],
): { oks: T[]; errs: E[] } {
  const oks: T[] = [];
  const errs: E[] = [];
  for (const r of results) {
    if (r.ok) oks.push(r.value);
    else errs.push(r.error);
  }
  return { oks, errs };
}

// ─── Try/Catch Bridges ───────────────────────────────────────────────────────

/** Wrap a throwing function into Result. Used ONLY in adapters. */
export function tryCatch<T, E>(
  fn: () => T,
  onError: (error: unknown) => E,
): Result<T, E> {
  try {
    return ok(fn());
  } catch (e) {
    return err(onError(e));
  }
}

/** Wrap an async throwing function into Result. Used ONLY in adapters. */
export async function tryCatchAsync<T, E>(
  fn: () => Promise<T>,
  onError: (error: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(onError(e));
  }
}
