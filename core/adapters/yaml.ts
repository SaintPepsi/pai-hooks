/**
 * Safe YAML adapter — wraps yaml parse so callers avoid try-catch.
 *
 * Adapter files are excluded from CodingStandardsEnforcer.
 */

import { parse } from "yaml";

/**
 * Parse a YAML string, returning null on invalid input instead of throwing.
 */
export function safeParseYaml(content: string, stderr?: (msg: string) => void): unknown | null {
  try {
    return parse(content);
  } catch (e) {
    stderr?.(`[safeParseYaml] parse failed: ${e instanceof Error ? e.message : "parse error"}`);
    return null;
  }
}
