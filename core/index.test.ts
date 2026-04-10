/**
 * Compile-time assertion that the barrel re-exports the expected SDK types.
 * Not a runtime test — TypeScript's existence check is the verification.
 */
import { describe, expect, it } from "bun:test";
import {
  type HookSpecificEventName,
  type NonHookSpecificEvent,
  type SyncHookJSONOutput,
  validateHookOutput,
} from "./index";

describe("core/index barrel exports", () => {
  it("re-exports SDK output types and the validate function", () => {
    // Compile-time: all four names must resolve via the barrel.
    const _eventName: HookSpecificEventName = "PreToolUse";
    const _nonEvent: NonHookSpecificEvent = "PreCompact";
    const _output: SyncHookJSONOutput = { continue: true };
    expect(typeof validateHookOutput).toBe("function");
    expect(_eventName).toBe("PreToolUse");
    expect(_nonEvent).toBe("PreCompact");
    expect(_output.continue).toBe(true);
  });
});
