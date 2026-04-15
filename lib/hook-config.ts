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
import { configValidationFailed, fileReadFailed, jsonParseFailed, type ResultError } from "@hooks/core/error";
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
 * @remarks
 * **Escape hatch**: The untyped overload (no schema) returns `T | null` with
 * no runtime validation. Prefer the schema overload whenever possible — it
 * validates config at the boundary and returns a typed `Result<T, ResultError>`
 * so failures are explicit instead of silently returning null.
 *
 * @param hookName - The key under hookConfig (e.g. "duplicationChecker")
 * @param readFileFn - Optional file reader override (for testing/DI)
 * @param settingsPath - Optional settings path override (for testing)
 * @param stderr - Optional stderr logger; called with a message on read/parse failures
 */
export function readHookConfig<T = Record<string, unknown>>(
  hookName: string,
  readFileFn?: (path: string) => string | null,
  settingsPath?: string,
  stderr?: (msg: string) => void,
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
 * @param stderr - Optional stderr logger; called with the error message on failure
 */
export function readHookConfig<T>(
  hookName: string,
  schema: Schema.Schema<T>,
  readFileFn?: (path: string) => string | null,
  settingsPath?: string,
  stderr?: (msg: string) => void,
): Result<T, ResultError>;

export function readHookConfig<T>(
  hookName: string,
  schemaOrReadFileFn?: Schema.Schema<T> | ((path: string) => string | null),
  readFileFnOrSettingsPath?: ((path: string) => string | null) | string,
  settingsPathOrStderr?: string | ((msg: string) => void),
  stderr?: (msg: string) => void,
): T | null | Result<T, ResultError> {
  // Detect which overload was called by checking if second arg is an Effect Schema.
  // Schemas are functions (not plain functions) — Schema.isSchema correctly distinguishes
  // them from the readFileFn option in the untyped overload.
  const isSchemaOverload =
    schemaOrReadFileFn !== undefined && Schema.isSchema(schemaOrReadFileFn);

  if (isSchemaOverload) {
    const schema = schemaOrReadFileFn as Schema.Schema<T>;
    const readFileFn = readFileFnOrSettingsPath as ((path: string) => string | null) | undefined;
    const resolvedSettingsPath = settingsPathOrStderr as string | undefined;
    const resolvedStderr = stderr;
    const raw = readRaw(hookName, readFileFn, resolvedSettingsPath);
    if (!raw.ok) {
      const error = configValidationFailed(hookName, raw.error);
      resolvedStderr?.(error.message);
      return err(error);
    }
    const decode = Schema.decodeUnknownEither(schema);
    const result = decode(raw.value);
    if (result._tag === "Right") return ok(result.right);
    const error = configValidationFailed(hookName, result.left);
    resolvedStderr?.(error.message);
    return err(error);
  }

  // Untyped overload
  const readFileFn = schemaOrReadFileFn as ((path: string) => string | null) | undefined;
  const resolvedSettingsPath =
    typeof readFileFnOrSettingsPath === "string" ? readFileFnOrSettingsPath : undefined;
  const resolvedStderr =
    typeof settingsPathOrStderr === "function" ? settingsPathOrStderr : undefined;
  const raw = readRaw(hookName, readFileFn, resolvedSettingsPath);
  if (!raw.ok) {
    resolvedStderr?.(raw.error.message);
    return null;
  }
  return raw.value as T;
}

/**
 * Internal helper: reads and extracts the raw hookConfig.{hookName} object.
 * Returns ok(value) on success, err(ResultError) on any failure.
 */
function readRaw(
  hookName: string,
  readFileFn?: (path: string) => string | null,
  settingsPath?: string,
): Result<Record<string, unknown>, ResultError> {
  const path = settingsPath ?? getSettingsPath();
  const reader =
    readFileFn ??
    ((p: string) => {
      const r = readFile(p);
      return r.ok ? r.value : null;
    });
  const raw = reader(path);
  if (!raw) return err(fileReadFailed(path, new Error("File not found or empty")));

  const parseResult = tryCatch(
    () => JSON.parse(raw) as SettingsWithHookConfig,
    (cause) => jsonParseFailed(raw.slice(0, 100), cause),
  );
  if (!parseResult.ok) return err(parseResult.error);

  const cfg = parseResult.value?.hookConfig?.[hookName];
  if (!cfg || typeof cfg !== "object") {
    return err(
      configValidationFailed(hookName, new Error(`Hook config not found for "${hookName}"`)),
    );
  }
  return ok(cfg as Record<string, unknown>);
}
