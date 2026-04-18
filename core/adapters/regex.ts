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
 * Pass onError to log invalid patterns (#169).
 */
export function safeRegexTest(
  input: string,
  pattern: string,
  flags = "",
  onError?: (pattern: string, err: Error) => void,
): boolean {
  try {
    return new RegExp(pattern, flags).test(input);
  } catch (e) {
    if (onError && e instanceof Error) onError(pattern, e);
    return false;
  }
}

/**
 * Create a RegExp from a string pattern.
 * Returns null (instead of throwing) when the pattern is invalid.
 * Pass onError to log invalid patterns (#169).
 */
export function createRegex(
  pattern: string,
  flags = "",
  onError?: (pattern: string, err: Error) => void,
): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    if (onError && e instanceof Error) onError(pattern, e);
    return null;
  }
}
