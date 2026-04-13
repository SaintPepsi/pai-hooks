/**
 * hooks/core — Barrel export for the PAI hook infrastructure.
 *
 * Contracts import from './core' only. This is the single entry point.
 */

// SDK output type (source of truth)
export type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
// Model constants
export * from "@hooks/core/constants";
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
export {
  buildChildEnv,
  type ExecResult,
  exec,
  getEnv,
  type SpawnSyncResult,
  spawnDetached,
} from "@hooks/core/adapters/process";
// Adapters
export { readStdin } from "@hooks/core/adapters/stdin";
// Contract interface
export type { HookContract } from "@hooks/core/contract";
// Error types
export {
  cancelled,
  configValidationFailed,
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
  processExecFailed,
  processSpawnFailed,
  ResultError,
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
// Type helpers derived from SDK
export type {
  HookSpecificEventName,
  NonHookSpecificEvent,
} from "@hooks/core/types/hook-output-helpers";
// Output schema validation
export { validateHookOutput } from "@hooks/core/types/hook-output-schema";
