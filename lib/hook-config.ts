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
import {
  configValidationFailed,
  fileReadFailed,
  jsonParseFailed,
  type ResultError,
} from "@hooks/core/error";
import { err, ok, type Result, tryCatch } from "@hooks/core/result";
import { getSettingsPath } from "@hooks/lib/paths";
import { Schema } from "effect";

interface SettingsWithHookConfig {
  hookConfig?: Record<string, unknown>;
}

/**
 * Read a hook's config section from settings.json (untyped, fail-open).
 *
 * **ESCAPE HATCH**: This overload returns unvalidated data. Prefer the
 * schema-validated overload for type safety at the config boundary.
 *
 * Navigates to `hookConfig.{hookName}` and returns the value,
 * or null if not configured / on any read or parse error.
 * Callers must validate the returned shape before use.
 *
 * @param hookName - The key under hookConfig (e.g. "duplicationChecker")
 * @param readFileFn - Optional file reader override (for testing/DI)
 * @param settingsPath - Optional settings path override (for testing)
 * @param logStderr - Optional stderr logger called with a message on each failure
 * @returns T | null — caller is responsible for validating shape
 */
export function readHookConfig<T = Record<string, unknown>>(
  hookName: string,
  readFileFn?: (path: string) => string | null,
  settingsPath?: string,
  logStderr?: (msg: string) => void,
): T | null;

/**
 * Read and validate a hook's config section from settings.json (PREFERRED).
 *
 * Validates against `schema` using Effect Schema. Returns `Result<T, ResultError>`
 * with distinct error codes per failure mode:
 *   - `FileReadFailed` — settings.json could not be read
 *   - `JsonParseFailed` — settings.json contains invalid JSON
 *   - `ConfigValidationFailed` — key missing, not an object, or schema invalid
 *
 * This is the recommended API: validation happens at the config boundary,
 * ensuring type safety without caller-side casts.
 *
 * @param hookName - The key under hookConfig (e.g. "duplicationChecker")
 * @param schema - Effect Schema to validate against
 * @param readFileFn - Optional file reader override (for testing/DI)
 * @param settingsPath - Optional settings path override (for testing)
 * @param logStderr - Optional stderr logger called with a message on each failure
 * @returns Result<T, ResultError> — validated config or typed error
 */
export function readHookConfig<T>(
  hookName: string,
  schema: Schema.Schema<T>,
  readFileFn?: (path: string) => string | null,
  settingsPath?: string,
  logStderr?: (msg: string) => void,
): Result<T, ResultError>;

export function readHookConfig<T>(
  hookName: string,
  schemaOrReadFileFn?: Schema.Schema<T> | ((path: string) => string | null),
  readFileFnOrSettingsPath?: ((path: string) => string | null) | string,
  settingsPathOrLogStderr?: string | ((msg: string) => void),
  logStderr?: (msg: string) => void,
): T | null | Result<T, ResultError> {
  // Detect which overload was called by checking if second arg is an Effect Schema.
  // Schemas are functions (not plain functions) — Schema.isSchema correctly distinguishes
  // them from the readFileFn option in the untyped overload.
  const isSchemaOverload = schemaOrReadFileFn !== undefined && Schema.isSchema(schemaOrReadFileFn);

  if (isSchemaOverload) {
    const schema = schemaOrReadFileFn as Schema.Schema<T>;
    const readFileFn = readFileFnOrSettingsPath as ((path: string) => string | null) | undefined;
    const resolvedSettingsPath = settingsPathOrLogStderr as string | undefined;
    const raw = readRaw(hookName, readFileFn, resolvedSettingsPath, logStderr);
    if (!raw.ok) return raw;
    const decode = Schema.decodeUnknownEither(schema);
    const result = decode(raw.value);
    if (result._tag === "Right") return ok(result.right);
    const validationError = configValidationFailed(hookName, result.left);
    logStderr?.(validationError.toString());
    return err(validationError);
  }

  // Untyped overload
  const readFileFn = schemaOrReadFileFn as ((path: string) => string | null) | undefined;
  const resolvedSettingsPath = readFileFnOrSettingsPath as string | undefined;
  const resolvedLogStderr = settingsPathOrLogStderr as ((msg: string) => void) | undefined;
  const raw = readRaw(hookName, readFileFn, resolvedSettingsPath, resolvedLogStderr);
  return raw.ok ? (raw.value as T) : null;
}

/**
 * Internal helper: reads and extracts the raw hookConfig.{hookName} object.
 *
 * Returns a Result with distinct error codes per failure mode:
 *   - `FileReadFailed` — settings.json could not be read
 *   - `JsonParseFailed` — settings.json contains invalid JSON
 *   - `ConfigValidationFailed` — hookConfig key missing or not an object
 *
 * If `logStderr` is provided it is called with the error message before returning.
 */
function readRaw(
  hookName: string,
  readFileFn?: (path: string) => string | null,
  settingsPath?: string,
  logStderr?: (msg: string) => void,
): Result<Record<string, unknown>, ResultError> {
  const path = settingsPath ?? getSettingsPath();
  const reader =
    readFileFn ??
    ((p: string) => {
      const r = readFile(p);
      return r.ok ? r.value : null;
    });
  const raw = reader(path);
  if (!raw) {
    const e = fileReadFailed(path, new Error("File not found or empty"));
    logStderr?.(e.toString());
    return err(e);
  }

  const parseResult = tryCatch(
    () => JSON.parse(raw) as SettingsWithHookConfig,
    (cause) => jsonParseFailed(raw.slice(0, 100), cause),
  );
  if (!parseResult.ok) {
    logStderr?.(parseResult.error.toString());
    return parseResult;
  }

  const cfg = parseResult.value?.hookConfig?.[hookName];
  if (!cfg || typeof cfg !== "object") {
    const e = configValidationFailed(hookName, new Error("Hook config not found or not an object"));
    logStderr?.(e.toString());
    return err(e);
  }
  return ok(cfg as Record<string, unknown>);
}
