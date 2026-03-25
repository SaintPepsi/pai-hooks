/**
 * pipe() — Thread a value through a chain of Result-returning functions.
 *
 * Short-circuits on first Err. Each step receives the Ok value from the
 * previous step. If all steps succeed, returns the final Ok value.
 */

import type { Result } from "@hooks/cli/core/result";

type PipeFn<T, U, E> = (value: T) => Result<U, E>;

/**
 * Thread a value through a sequence of Result-returning functions.
 * Short-circuits on the first Err encountered.
 */
export function pipe<A, E>(
  initial: Result<A, E>,
): Result<A, E>;
export function pipe<A, B, E>(
  initial: Result<A, E>,
  fn1: PipeFn<A, B, E>,
): Result<B, E>;
export function pipe<A, B, C, E>(
  initial: Result<A, E>,
  fn1: PipeFn<A, B, E>,
  fn2: PipeFn<B, C, E>,
): Result<C, E>;
export function pipe<A, B, C, D, E>(
  initial: Result<A, E>,
  fn1: PipeFn<A, B, E>,
  fn2: PipeFn<B, C, E>,
  fn3: PipeFn<C, D, E>,
): Result<D, E>;
export function pipe<A, B, C, D, F, E>(
  initial: Result<A, E>,
  fn1: PipeFn<A, B, E>,
  fn2: PipeFn<B, C, E>,
  fn3: PipeFn<C, D, E>,
  fn4: PipeFn<D, F, E>,
): Result<F, E>;
export function pipe(
  initial: Result<unknown, unknown>,
  ...fns: PipeFn<unknown, unknown, unknown>[]
): Result<unknown, unknown> {
  let current = initial;
  for (const fn of fns) {
    if (!current.ok) return current;
    current = fn(current.value);
  }
  return current;
}
