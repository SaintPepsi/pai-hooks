/**
 * ResultError — Typed error contracts for PAI hooks.
 *
 * Every hook error has an ErrorCode, a human-readable message, and optional
 * cause for error chain debugging. Factory functions create specific errors.
 */

// ─── Error Codes ─────────────────────────────────────────────────────────────

export enum ErrorCode {
  // Stdin/Input
  StdinTimeout = "STDIN_TIMEOUT",
  StdinReadFailed = "STDIN_READ_FAILED",
  JsonParseFailed = "JSON_PARSE_FAILED",
  InvalidInput = "INVALID_INPUT",

  // File System
  FileNotFound = "FILE_NOT_FOUND",
  FileReadFailed = "FILE_READ_FAILED",
  FileWriteFailed = "FILE_WRITE_FAILED",
  DirCreateFailed = "DIR_CREATE_FAILED",

  // Process
  ProcessExecFailed = "PROCESS_EXEC_FAILED",
  ProcessSpawnFailed = "PROCESS_SPAWN_FAILED",
  EnvVarMissing = "ENV_VAR_MISSING",

  // Network
  FetchFailed = "FETCH_FAILED",
  FetchTimeout = "FETCH_TIMEOUT",

  // Hook Logic
  SecurityBlock = "SECURITY_BLOCK",
  ContractViolation = "CONTRACT_VIOLATION",
  StateCorrupted = "STATE_CORRUPTED",
  ConfigValidationFailed = "CONFIG_VALIDATION_FAILED",

  // System
  Unknown = "UNKNOWN",
  Cancelled = "CANCELLED",
}

// ─── ResultError Class ──────────────────────────────────────────────────────────

export class ResultError extends Error {
  readonly code: ErrorCode;
  override readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ResultError";
    this.code = code;
    this.cause = cause;
  }

  override toString(): string {
    return `[${this.code}] ${this.message}`;
  }
}

// ─── Factory Functions ───────────────────────────────────────────────────────

export function stdinTimeout(timeoutMs: number): ResultError {
  return new ResultError(ErrorCode.StdinTimeout, `Stdin read timed out after ${timeoutMs}ms`);
}

export function stdinReadFailed(cause: unknown): ResultError {
  return new ResultError(ErrorCode.StdinReadFailed, "Failed to read stdin", cause);
}

export function jsonParseFailed(raw: string, cause: unknown): ResultError {
  const preview = raw.length > 80 ? `${raw.slice(0, 80)}...` : raw;
  return new ResultError(ErrorCode.JsonParseFailed, `Invalid JSON: ${preview}`, cause);
}

export function invalidInput(reason: string): ResultError {
  return new ResultError(ErrorCode.InvalidInput, reason);
}

export function fileNotFound(path: string): ResultError {
  return new ResultError(ErrorCode.FileNotFound, `File not found: ${path}`);
}

export function fileReadFailed(path: string, cause: unknown): ResultError {
  return new ResultError(ErrorCode.FileReadFailed, `Failed to read: ${path}`, cause);
}

export function fileWriteFailed(path: string, cause: unknown): ResultError {
  return new ResultError(ErrorCode.FileWriteFailed, `Failed to write: ${path}`, cause);
}

export function dirCreateFailed(path: string, cause: unknown): ResultError {
  return new ResultError(ErrorCode.DirCreateFailed, `Failed to create directory: ${path}`, cause);
}

export function processExecFailed(cmd: string, cause: unknown): ResultError {
  return new ResultError(ErrorCode.ProcessExecFailed, `Command failed: ${cmd}`, cause);
}

export function processSpawnFailed(cmd: string, cause: unknown): ResultError {
  return new ResultError(ErrorCode.ProcessSpawnFailed, `Failed to spawn: ${cmd}`, cause);
}

export function envVarMissing(name: string): ResultError {
  return new ResultError(ErrorCode.EnvVarMissing, `Environment variable not set: ${name}`);
}

export function fetchFailed(url: string, cause: unknown): ResultError {
  return new ResultError(ErrorCode.FetchFailed, `Fetch failed: ${url}`, cause);
}

export function fetchTimeout(url: string, timeoutMs: number): ResultError {
  return new ResultError(ErrorCode.FetchTimeout, `Fetch timed out after ${timeoutMs}ms: ${url}`);
}

export function securityBlock(reason: string): ResultError {
  return new ResultError(ErrorCode.SecurityBlock, reason);
}

export function contractViolation(hook: string, reason: string): ResultError {
  return new ResultError(ErrorCode.ContractViolation, `${hook}: ${reason}`);
}

export function stateCorrupted(path: string, cause: unknown): ResultError {
  return new ResultError(ErrorCode.StateCorrupted, `Corrupted state at: ${path}`, cause);
}

export function unknownError(cause: unknown): ResultError {
  const msg = cause instanceof Error ? cause.message : String(cause);
  return new ResultError(ErrorCode.Unknown, msg, cause);
}

export function cancelled(reason: string): ResultError {
  return new ResultError(ErrorCode.Cancelled, reason);
}

export function configValidationFailed(hookName: string, cause: unknown): ResultError {
  const msg = cause instanceof Error ? cause.message : String(cause);
  return new ResultError(
    ErrorCode.ConfigValidationFailed,
    `Config validation failed for "${hookName}": ${msg}`,
    cause,
  );
}
