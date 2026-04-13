/**
 * Shared hook configuration reader.
 *
 * Reads settings.json, parses JSON, and navigates to
 * hookConfig.{hookName} in a single call.
 *
 * Two overloads:
 *   - Without schema: returns T | null (existing behavior, fail-open)
 *   - With schema: returns Result<T, ResultError> (validated, fail-explicit)
 */

import { readFile } from "@hooks/core/adapters/fs";
import { configValidationFailed, jsonParseFailed, type ResultError } from "@hooks/core/error";
import { err, ok, type Result, tryCatch } from "@hooks/core/result";
import { getSettingsPath } from "@hooks/lib/paths";
import { Schema } from "effect";

interface SettingsWithHookConfig {
  hookConfig?: Record<string, unknown>;
}

/**
 * Read a hook's config section from settings.json.
 *
 * Navigates to `hookConfig.{hookName}` and returns the value,
 * or null if not configured / on any read or parse error.
 *
 * @param hookName - The key under hookConfig (e.g. "duplicationChecker")
 * @param readFileFn - Optional file reader override (for testing/DI)
 * @param settingsPath - Optional settings path override (for testing)
 */
export function readHookConfig<T = Record<string, unknown>>(
  hookName: string,
  readFileFn?: (path: string) => string | null,
  settingsPath?: string,
): T | null;

/**
 * Read and validate a hook's config section from settings.json.
 *
 * Like the untyped overload but validates against `schema` using Effect Schema.
 * Returns `Result<T, ResultError>` — ok on success, err with
 * `ConfigValidationFailed` if the config is missing or fails validation.
 *
 * @param hookName - The key under hookConfig (e.g. "duplicationChecker")
 * @param schema - Effect Schema to validate against
 * @param readFileFn - Optional file reader override (for testing/DI)
 * @param settingsPath - Optional settings path override (for testing)
 */
export function readHookConfig<T>(
  hookName: string,
  schema: Schema.Schema<T>,
  readFileFn?: (path: string) => string | null,
  settingsPath?: string,
): Result<T, ResultError>;

export function readHookConfig<T>(
  hookName: string,
  schemaOrReadFileFn?: Schema.Schema<T> | ((path: string) => string | null),
  readFileFnOrSettingsPath?: ((path: string) => string | null) | string,
  settingsPath?: string,
): T | null | Result<T, ResultError> {
  // Detect which overload was called by checking if second arg is an Effect Schema.
  // Schemas are functions (not plain functions) — Schema.isSchema correctly distinguishes
  // them from the readFileFn option in the untyped overload.
  const isSchemaOverload =
    schemaOrReadFileFn !== undefined && Schema.isSchema(schemaOrReadFileFn);

  if (isSchemaOverload) {
    const schema = schemaOrReadFileFn as Schema.Schema<T>;
    const readFileFn = readFileFnOrSettingsPath as ((path: string) => string | null) | undefined;
    const resolvedSettingsPath = settingsPath;
    const raw = readRaw(hookName, readFileFn, resolvedSettingsPath);
    if (raw === null) {
      return err(configValidationFailed(hookName, new Error("Hook config not found")));
    }
    const decode = Schema.decodeUnknownEither(schema);
    const result = decode(raw);
    if (result._tag === "Right") return ok(result.right);
    return err(configValidationFailed(hookName, result.left));
  }

  // Untyped overload
  const readFileFn = schemaOrReadFileFn as ((path: string) => string | null) | undefined;
  const resolvedSettingsPath = readFileFnOrSettingsPath as string | undefined;
  return readRaw(hookName, readFileFn, resolvedSettingsPath) as T | null;
}

/**
 * Internal helper: reads and extracts the raw hookConfig.{hookName} object.
 * Returns the raw value (unknown object) or null on any error.
 */
function readRaw(
  hookName: string,
  readFileFn?: (path: string) => string | null,
  settingsPath?: string,
): Record<string, unknown> | null {
  const path = settingsPath ?? getSettingsPath();
  const reader =
    readFileFn ??
    ((p: string) => {
      const r = readFile(p);
      return r.ok ? r.value : null;
    });
  const raw = reader(path);
  if (!raw) return null;

  const parseResult = tryCatch(
    () => JSON.parse(raw) as SettingsWithHookConfig,
    (cause) => jsonParseFailed(raw.slice(0, 100), cause),
  );
  if (!parseResult.ok) return null;

  const cfg = parseResult.value?.hookConfig?.[hookName];
  if (!cfg || typeof cfg !== "object") return null;
  return cfg as Record<string, unknown>;
}
