/**
 * PaiError — Typed error contracts for PAI hooks.
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

  // System
  Unknown = "UNKNOWN",
  Cancelled = "CANCELLED",
}

// ─── PaiError Class ──────────────────────────────────────────────────────────

export class PaiError extends Error {
  readonly code: ErrorCode;
  override readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "PaiError";
    this.code = code;
    this.cause = cause;
  }

  override toString(): string {
    return `[${this.code}] ${this.message}`;
  }
}

// ─── Factory Functions ───────────────────────────────────────────────────────

export function stdinTimeout(timeoutMs: number): PaiError {
  return new PaiError(ErrorCode.StdinTimeout, `Stdin read timed out after ${timeoutMs}ms`);
}

export function stdinReadFailed(cause: unknown): PaiError {
  return new PaiError(ErrorCode.StdinReadFailed, "Failed to read stdin", cause);
}

export function jsonParseFailed(raw: string, cause: unknown): PaiError {
  const preview = raw.length > 80 ? raw.slice(0, 80) + "..." : raw;
  return new PaiError(ErrorCode.JsonParseFailed, `Invalid JSON: ${preview}`, cause);
}

export function invalidInput(reason: string): PaiError {
  return new PaiError(ErrorCode.InvalidInput, reason);
}

export function fileNotFound(path: string): PaiError {
  return new PaiError(ErrorCode.FileNotFound, `File not found: ${path}`);
}

export function fileReadFailed(path: string, cause: unknown): PaiError {
  return new PaiError(ErrorCode.FileReadFailed, `Failed to read: ${path}`, cause);
}

export function fileWriteFailed(path: string, cause: unknown): PaiError {
  return new PaiError(ErrorCode.FileWriteFailed, `Failed to write: ${path}`, cause);
}

export function dirCreateFailed(path: string, cause: unknown): PaiError {
  return new PaiError(ErrorCode.DirCreateFailed, `Failed to create directory: ${path}`, cause);
}

export function processExecFailed(cmd: string, cause: unknown): PaiError {
  return new PaiError(ErrorCode.ProcessExecFailed, `Command failed: ${cmd}`, cause);
}

export function processSpawnFailed(cmd: string, cause: unknown): PaiError {
  return new PaiError(ErrorCode.ProcessSpawnFailed, `Failed to spawn: ${cmd}`, cause);
}

export function envVarMissing(name: string): PaiError {
  return new PaiError(ErrorCode.EnvVarMissing, `Environment variable not set: ${name}`);
}

export function fetchFailed(url: string, cause: unknown): PaiError {
  return new PaiError(ErrorCode.FetchFailed, `Fetch failed: ${url}`, cause);
}

export function fetchTimeout(url: string, timeoutMs: number): PaiError {
  return new PaiError(ErrorCode.FetchTimeout, `Fetch timed out after ${timeoutMs}ms: ${url}`);
}

export function securityBlock(reason: string): PaiError {
  return new PaiError(ErrorCode.SecurityBlock, reason);
}

export function contractViolation(hook: string, reason: string): PaiError {
  return new PaiError(ErrorCode.ContractViolation, `${hook}: ${reason}`);
}

export function stateCorrupted(path: string, cause: unknown): PaiError {
  return new PaiError(ErrorCode.StateCorrupted, `Corrupted state at: ${path}`, cause);
}

export function unknownError(cause: unknown): PaiError {
  const msg = cause instanceof Error ? cause.message : String(cause);
  return new PaiError(ErrorCode.Unknown, msg, cause);
}

export function cancelled(reason: string): PaiError {
  return new PaiError(ErrorCode.Cancelled, reason);
}
