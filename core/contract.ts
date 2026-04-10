/**
 * HookContract — The interface every hook must implement.
 *
 * Contracts are pure logic. No I/O, no try/catch. The runner handles
 * stdin, parsing, error recovery, and output formatting.
 *
 * Three variants:
 *   SyncHookContract  — execute returns Result (most hooks)
 *   AsyncHookContract — execute returns Promise<Result> (I/O-heavy hooks)
 *   HookContract      — union of both (used by the runner)
 *
 * Type parameters:
 *   I = input type (what the hook receives after parsing)
 *   D = deps type (injectable dependencies for testing)
 *
 * Output type is always SyncHookJSONOutput from the SDK — no custom output types.
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { HookEventType, HookInput } from "@hooks/core/types/hook-inputs";

interface HookContractBase<I extends HookInput = HookInput, D = unknown> {
  /** Human-readable hook name for logging and error context. */
  name: string;

  /** Which hook event type(s) this contract handles. */
  event: HookEventType | HookEventType[];

  /** ISP gate: return true if this hook should process the given input. */
  accepts(input: I): boolean;

  /** DIP injection point: default production dependencies. */
  defaultDeps: D;
}

export interface SyncHookContract<I extends HookInput = HookInput, D = unknown>
  extends HookContractBase<I, D> {
  /** SRP core: synchronous pure business logic. Returns Result, never throws. */
  execute(input: I, deps: D): Result<SyncHookJSONOutput, ResultError>;
}

export interface AsyncHookContract<I extends HookInput = HookInput, D = unknown>
  extends HookContractBase<I, D> {
  /** SRP core: async business logic. Returns Promise<Result>, never throws. */
  execute(input: I, deps: D): Promise<Result<SyncHookJSONOutput, ResultError>>;
}

/** Union type accepted by the runner. Contracts should use SyncHookContract or AsyncHookContract. */
export type HookContract<I extends HookInput = HookInput, D = unknown> =
  | SyncHookContract<I, D>
  | AsyncHookContract<I, D>;
