/**
 * CLI Result — Re-exports core Result types for CLI usage.
 *
 * The CLI uses the same Result<T, E> foundation as the hook system.
 * Re-exporting keeps a single source of truth while allowing
 * CLI code to import from @hooks/cli/core/result.
 */

export {
  type Result,
  type Ok,
  type Err,
  ok,
  err,
  andThen,
  map,
  mapError,
  match,
  unwrapOr,
  collectResults,
  partitionResults,
} from "@hooks/core/result";
