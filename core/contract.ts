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
 *   O = output type (what the hook returns)
 *   D = deps type (injectable dependencies for testing)
 */

import type { HookEventType, HookInput } from "@hooks/core/types/hook-inputs";
import type { HookOutput } from "@hooks/core/types/hook-outputs";
import type { Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";

interface HookContractBase<
  I extends HookInput = HookInput,
  O extends HookOutput = HookOutput,
  D = unknown,
> {
  /** Human-readable hook name for logging and error context. */
  name: string;

  /** Which hook event type this contract handles. */
  event: HookEventType;

  /** ISP gate: return true if this hook should process the given input. */
  accepts(input: I): boolean;

  /** DIP injection point: default production dependencies. */
  defaultDeps: D;
}

export interface SyncHookContract<
  I extends HookInput = HookInput,
  O extends HookOutput = HookOutput,
  D = unknown,
> extends HookContractBase<I, O, D> {
  /** SRP core: synchronous pure business logic. Returns Result, never throws. */
  execute(input: I, deps: D): Result<O, PaiError>;
}

export interface AsyncHookContract<
  I extends HookInput = HookInput,
  O extends HookOutput = HookOutput,
  D = unknown,
> extends HookContractBase<I, O, D> {
  /** SRP core: async business logic. Returns Promise<Result>, never throws. */
  execute(input: I, deps: D): Promise<Result<O, PaiError>>;
}

/** Union type accepted by the runner. Contracts should use SyncHookContract or AsyncHookContract. */
export type HookContract<
  I extends HookInput = HookInput,
  O extends HookOutput = HookOutput,
  D = unknown,
> = SyncHookContract<I, O, D> | AsyncHookContract<I, O, D>;
