/**
 * Safe YAML adapter — wraps yaml parse so callers avoid try-catch.
 *
 * Adapter files are excluded from CodingStandardsEnforcer.
 */

import { parse } from "yaml";

/**
 * Parse a YAML string, returning null on invalid input instead of throwing.
 */
export function safeParseYaml(content: string): unknown | null {
  try {
    return parse(content);
  } catch {
    return null;
  }
}
