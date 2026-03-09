/**
 * HookContract — The interface every hook must implement.
 *
 * Contracts are pure logic. No I/O, no try/catch. The runner handles
 * stdin, parsing, error recovery, and output formatting.
 *
 * Type parameters:
 *   I = input type (what the hook receives after parsing)
 *   O = output type (what the hook returns)
 *   D = deps type (injectable dependencies for testing)
 */

import type { HookEventType, HookInput } from "./types/hook-inputs";
import type { HookOutput } from "./types/hook-outputs";
import type { Result } from "./result";
import type { PaiError } from "./error";

export interface HookContract<
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

  /** SRP core: pure business logic. Returns Result, never throws. */
  execute(input: I, deps: D): Result<O, PaiError> | Promise<Result<O, PaiError>>;

  /** DIP injection point: default production dependencies. */
  defaultDeps: D;
}
