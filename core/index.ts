/**
 * hooks/core — Barrel export for the PAI hook infrastructure.
 *
 * Contracts import from './core' only. This is the single entry point.
 */

// Result type
export {
  type Result,
  type Ok,
  type Err,
  ok,
  err,
  andThen,
  map,
  mapError,
  match,
  unwrapOr,
  collectResults,
  partitionResults,
  tryCatch,
  tryCatchAsync,
} from "./result";

// Error types
export {
  PaiError,
  ErrorCode,
  stdinTimeout,
  stdinReadFailed,
  jsonParseFailed,
  invalidInput,
  fileNotFound,
  fileReadFailed,
  fileWriteFailed,
  dirCreateFailed,
  processExecFailed,
  processSpawnFailed,
  envVarMissing,
  fetchFailed,
  fetchTimeout,
  securityBlock,
  contractViolation,
  stateCorrupted,
  unknownError,
  cancelled,
} from "./error";

// Contract interface
export { type HookContract } from "./contract";

// Input types
export {
  type HookEventType,
  type HookInputBase,
  type ToolHookInput,
  type SessionStartInput,
  type SessionEndInput,
  type UserPromptSubmitInput,
  type StopInput,
  type HookInput,
} from "./types/hook-inputs";

// Output types
export {
  type ContinueOutput,
  type BlockOutput,
  type AskOutput,
  type ContextOutput,
  type SilentOutput,
  type HookOutput,
  continueOk,
  block,
  ask,
  context,
  silent,
} from "./types/hook-outputs";

// Runner
export { runHook, type RunHookOptions } from "./runner";

// Adapters
export { readStdin } from "./adapters/stdin";
export {
  readFile,
  readJson,
  writeFile,
  writeJson,
  appendFile,
  ensureDir,
  fileExists,
} from "./adapters/fs";
export { exec, spawnDetached, getEnv, type ExecResult } from "./adapters/process";
export { safeFetch, type FetchResult } from "./adapters/fetch";
