/**
 * hooks/core — Barrel export for the PAI hook infrastructure.
 *
 * Contracts import from './core' only. This is the single entry point.
 */

export { type FetchResult, safeFetch } from "@hooks/core/adapters/fetch";
export {
  appendFile,
  ensureDir,
  fileExists,
  readFile,
  readJson,
  writeFile,
  writeJson,
} from "@hooks/core/adapters/fs";
export { type ExecResult, exec, getEnv, spawnDetached } from "@hooks/core/adapters/process";
// Adapters
export { readStdin } from "@hooks/core/adapters/stdin";
// Contract interface
export type { HookContract } from "@hooks/core/contract";
// Error types
export {
  cancelled,
  contractViolation,
  dirCreateFailed,
  ErrorCode,
  envVarMissing,
  fetchFailed,
  fetchTimeout,
  fileNotFound,
  fileReadFailed,
  fileWriteFailed,
  invalidInput,
  jsonParseFailed,
  PaiError,
  processExecFailed,
  processSpawnFailed,
  securityBlock,
  stateCorrupted,
  stdinReadFailed,
  stdinTimeout,
  unknownError,
} from "@hooks/core/error";
// Result type
export {
  andThen,
  collectResults,
  type Err,
  err,
  map,
  mapError,
  match,
  type Ok,
  ok,
  partitionResults,
  type Result,
  tryCatch,
  tryCatchAsync,
  unwrapOr,
} from "@hooks/core/result";
// Runner
export { type RunHookOptions, runHook } from "@hooks/core/runner";
// Input types
export type {
  HookEventType,
  HookInput,
  HookInputBase,
  SessionEndInput,
  SessionStartInput,
  StopInput,
  ToolHookInput,
  UserPromptSubmitInput,
} from "@hooks/core/types/hook-inputs";
// Output types
export {
  type AskOutput,
  ask,
  type BlockOutput,
  block,
  type ContextOutput,
  type ContinueOutput,
  context,
  continueOk,
  type HookOutput,
  type SilentOutput,
  silent,
} from "@hooks/core/types/hook-outputs";
