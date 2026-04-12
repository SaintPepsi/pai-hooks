/**
 * Shared hook configuration reader.
 *
 * Reads settings.json, parses JSON, and navigates to
 * hookConfig.{hookName} in a single call. Returns null
 * if not configured or on any read/parse error.
 */

import { readFile } from "@hooks/core/adapters/fs";
import { jsonParseFailed } from "@hooks/core/error";
import { tryCatch } from "@hooks/core/result";
import { getSettingsPath } from "@hooks/lib/paths";

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
): T | null {
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
  return cfg as T;
}
