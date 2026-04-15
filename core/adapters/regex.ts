/**
 * Safe regex adapter — wraps RegExp construction so callers avoid try-catch.
 *
 * Adapter files are excluded from CodingStandardsEnforcer, so the
 * try-catch here is acceptable (it wraps a language-level API that
 * throws on invalid patterns, with no alternative validation path).
 */

/**
 * Test an input string against a regex pattern.
 * Returns false (instead of throwing) when the pattern is invalid.
 */
export function safeRegexTest(input: string, pattern: string, flags = "", stderr?: (msg: string) => void): boolean {
  try {
    return new RegExp(pattern, flags).test(input);
  } catch {
    stderr?.(`[regex] Invalid pattern: ${pattern}`);
    return false;
  }
}

/**
 * Create a RegExp from a string pattern.
 * Returns null (instead of throwing) when the pattern is invalid.
 */
export function createRegex(pattern: string, flags = "", stderr?: (msg: string) => void): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    stderr?.(`[regex] Invalid pattern: ${pattern}`);
    return null;
  }
}
