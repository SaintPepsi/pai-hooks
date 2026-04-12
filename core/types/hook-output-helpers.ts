/**
 * Type aliases derived from @anthropic-ai/claude-agent-sdk.
 *
 * These provide compile-time safety without runtime overhead.
 * No functions — just types extracted from the SDK union.
 */

import type { HookEvent, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

/** Event names that support hookSpecificOutput — derived from the SDK discriminated union. */
export type HookSpecificEventName = NonNullable<
  SyncHookJSONOutput["hookSpecificOutput"]
>["hookEventName"];

/**
 * Events that CANNOT use hookSpecificOutput.
 * Derived as the complement of HookSpecificEventName within the full SDK event union,
 * so it stays correct automatically when the SDK adds new events.
 */
export type NonHookSpecificEvent = Exclude<HookEvent, HookSpecificEventName>;
