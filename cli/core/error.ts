/**
 * PaihError — Typed error contracts for the paih CLI.
 *
 * Separate from core/error.ts (hook runtime errors). These codes cover
 * CLI-specific failure modes: resolution, manifest parsing, build, etc.
 */

// ─── Error Codes ─────────────────────────────────────────────────────────────

export enum PaihErrorCode {
  TargetNotFound = "TARGET_NOT_FOUND",
  HookNotFound = "HOOK_NOT_FOUND",
  ManifestMissing = "MANIFEST_MISSING",
  ManifestParseError = "MANIFEST_PARSE_ERROR",
  ManifestSchemaInvalid = "MANIFEST_SCHEMA_INVALID",
  DepCycle = "DEP_CYCLE",
  InvalidArgs = "INVALID_ARGS",
  BuildFailed = "BUILD_FAILED",
  SettingsConflict = "SETTINGS_CONFLICT",
  WriteFailed = "WRITE_FAILED",
  LockCorrupt = "LOCK_CORRUPT",
  LockMissing = "LOCK_MISSING",
  FileModified = "FILE_MODIFIED",
  HashError = "HASH_ERROR",
}

// ─── PaihError Class ─────────────────────────────────────────────────────────

export class PaihError extends Error {
  readonly code: PaihErrorCode;
  readonly context?: Record<string, unknown>;

  constructor(
    code: PaihErrorCode,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PaihError";
    this.code = code;
    this.context = context;
  }

  override toString(): string {
    return `[${this.code}] ${this.message}`;
  }
}

// ─── Factory Functions ───────────────────────────────────────────────────────

export function targetNotFound(startDir: string): PaihError {
  return new PaihError(
    PaihErrorCode.TargetNotFound,
    `No .claude/ directory found walking up from ${startDir}`,
    { startDir },
  );
}

export function hookNotFound(name: string): PaihError {
  return new PaihError(
    PaihErrorCode.HookNotFound,
    `No hook, group, or preset found matching "${name}"`,
    { name },
  );
}

export function manifestMissing(path: string): PaihError {
  return new PaihError(
    PaihErrorCode.ManifestMissing,
    `Manifest not found: ${path}`,
    { path },
  );
}

export function manifestParseError(path: string, cause: Error): PaihError {
  return new PaihError(
    PaihErrorCode.ManifestParseError,
    `Failed to parse manifest at ${path}: ${cause.message}`,
    { path, cause: cause.message },
  );
}

export function manifestSchemaInvalid(path: string, reason: string): PaihError {
  return new PaihError(
    PaihErrorCode.ManifestSchemaInvalid,
    `Invalid manifest schema at ${path}: ${reason}`,
    { path, reason },
  );
}

export function depCycle(cyclePath: string[]): PaihError {
  return new PaihError(
    PaihErrorCode.DepCycle,
    `Dependency cycle detected: ${cyclePath.join(" → ")}`,
    { cyclePath },
  );
}

export function invalidArgs(reason: string): PaihError {
  return new PaihError(PaihErrorCode.InvalidArgs, reason);
}

export function buildFailed(reason: string, cause?: Error): PaihError {
  return new PaihError(
    PaihErrorCode.BuildFailed,
    `Build failed: ${reason}${cause ? ` (${cause.message})` : ""}`,
    { reason },
  );
}

export function settingsConflict(key: string, reason: string): PaihError {
  return new PaihError(
    PaihErrorCode.SettingsConflict,
    `Settings conflict for "${key}": ${reason}`,
    { key, reason },
  );
}

export function writeFailed(path: string, cause?: Error): PaihError {
  return new PaihError(
    PaihErrorCode.WriteFailed,
    `Failed to write: ${path}${cause ? ` (${cause.message})` : ""}`,
    { path },
  );
}

export function lockCorrupt(path: string): PaihError {
  return new PaihError(
    PaihErrorCode.LockCorrupt,
    `Lock file corrupt or invalid: ${path}`,
    { path },
  );
}

export function lockMissing(claudeDir: string): PaihError {
  return new PaihError(
    PaihErrorCode.LockMissing,
    `No lockfile found at ${claudeDir}/hooks/pai-hooks/paih.lock.json. Run "paih install" first.`,
    { claudeDir },
  );
}

export function fileModified(filePath: string): PaihError {
  return new PaihError(
    PaihErrorCode.FileModified,
    `File modified since install: ${filePath}. Use --force to override.`,
    { filePath },
  );
}

export function hashError(filePath: string, cause?: string): PaihError {
  return new PaihError(
    PaihErrorCode.HashError,
    `Failed to compute hash for ${filePath}${cause ? `: ${cause}` : ""}`,
    { filePath },
  );
}
