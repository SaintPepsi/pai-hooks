/**
 * Safe YAML adapter — wraps yaml parse so callers avoid try-catch.
 *
 * Adapter files are excluded from CodingStandardsEnforcer.
 */

import { parse } from "yaml";

/**
 * Parse a YAML string, returning null on invalid input instead of throwing.
 * Pass onError to log parse failures (#168).
 */
export function safeParseYaml(content: string, onError?: (err: Error) => void): unknown | null {
  try {
    return parse(content);
  } catch (e) {
    if (onError && e instanceof Error) onError(e);
    return null;
  }
}
