/**
 * Compile-time assertion that the barrel re-exports the expected SDK types.
 * Not a runtime test — TypeScript's existence check is the verification.
 */
import { describe, expect, it } from "bun:test";
import {
  buildChildEnv,
  type ExecResult,
  type HookSpecificEventName,
  type NonHookSpecificEvent,
  type SpawnSyncResult,
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

  it("re-exports process-adapter helpers and types", () => {
    // Compile-time: buildChildEnv, ExecResult, SpawnSyncResult must resolve.
    expect(typeof buildChildEnv).toBe("function");
    const env = buildChildEnv({ PAI_BARREL_TEST: "1" });
    expect(env.PAI_BARREL_TEST).toBe("1");
    // Type-only sanity — constructs a value of each shape.
    const _exec: ExecResult = { stdout: "", stderr: "", exitCode: 0 };
    const _spawn: SpawnSyncResult = { stdout: "", stderr: "", exitCode: 0 };
    expect(_exec.exitCode).toBe(0);
    expect(_spawn.exitCode).toBe(0);
  });
});
