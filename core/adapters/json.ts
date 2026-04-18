/**
 * Safe JSON adapter — wraps JSON.parse so callers avoid try-catch.
 *
 * Adapter files are excluded from CodingStandardsEnforcer.
 */

import { invalidInput, type ResultError } from "@hooks/core/error";
import { err, ok, type Result } from "@hooks/core/result";

/**
 * Parse a JSON string, returning a Result instead of throwing.
 * Returns Result<unknown> so callers apply their own validated cast.
 */
export function safeJsonParse(content: string): Result<unknown, ResultError> {
  try {
    return ok(JSON.parse(content));
  } catch (e) {
    return err(invalidInput(`Invalid JSON: ${e instanceof Error ? e.message : "parse error"}`));
  }
}
