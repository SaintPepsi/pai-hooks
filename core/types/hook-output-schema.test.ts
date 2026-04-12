/**
 * Smoke tests for hook-output-schema.
 *
 * Verifies that `validateHookOutput` accepts canonical SyncHookJSONOutput
 * shapes for the main recipe cases (continue, PreToolUse permissionDecision,
 * PostToolUse additionalContext). These are structural sanity checks — the
 * schema is exercised in full by `core/runner.test.ts` and
 * `core/runner.coverage.test.ts` through the runner's `validateHookOutput`
 * call.
 */

import { describe, expect, it } from "bun:test";
import { validateHookOutput } from "./hook-output-schema";

describe("hook-output-schema", () => {
  it("validates a bare continue output (R1)", () => {
    const result = validateHookOutput({ continue: true });
    expect(result._tag).toBe("Right");
  });

  it("validates a PreToolUse permissionDecision deny output (R4)", () => {
    const result = validateHookOutput({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "unsafe path",
      },
    });
    expect(result._tag).toBe("Right");
  });

  it("validates a PostToolUse additionalContext output (R2)", () => {
    const result = validateHookOutput({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "context injection text",
      },
    });
    expect(result._tag).toBe("Right");
  });

  it("validates a non-PreToolUse top-level decision block output (R5)", () => {
    const result = validateHookOutput({
      decision: "block",
      reason: "PostToolUse block reason",
    });
    expect(result._tag).toBe("Right");
  });

  it("validates an empty output (R8 silent)", () => {
    const result = validateHookOutput({});
    expect(result._tag).toBe("Right");
  });

  it("validates defer as a valid permissionDecision (PreToolUse)", () => {
    const result = validateHookOutput({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "defer",
      },
    });
    expect(result._tag).toBe("Right");
  });

  it("validates PermissionDenied hookSpecificOutput round-trip", () => {
    const result = validateHookOutput({
      hookSpecificOutput: {
        hookEventName: "PermissionDenied",
        retry: true,
      },
    });
    expect(result._tag).toBe("Right");
  });

  it("validates Elicitation hookSpecificOutput round-trip", () => {
    const result = validateHookOutput({
      hookSpecificOutput: {
        hookEventName: "Elicitation",
        action: "accept",
        content: { confirmed: true },
      },
    });
    expect(result._tag).toBe("Right");
  });

  it("validates ElicitationResult hookSpecificOutput round-trip", () => {
    const result = validateHookOutput({
      hookSpecificOutput: {
        hookEventName: "ElicitationResult",
        action: "decline",
      },
    });
    expect(result._tag).toBe("Right");
  });

  it("validates CwdChanged hookSpecificOutput round-trip", () => {
    const result = validateHookOutput({
      hookSpecificOutput: {
        hookEventName: "CwdChanged",
        watchPaths: ["/tmp/project"],
      },
    });
    expect(result._tag).toBe("Right");
  });

  it("validates FileChanged hookSpecificOutput round-trip", () => {
    const result = validateHookOutput({
      hookSpecificOutput: {
        hookEventName: "FileChanged",
        watchPaths: ["/tmp/project/src/main.ts"],
      },
    });
    expect(result._tag).toBe("Right");
  });

  it("validates WorktreeCreate hookSpecificOutput round-trip", () => {
    const result = validateHookOutput({
      hookSpecificOutput: {
        hookEventName: "WorktreeCreate",
        worktreePath: "/tmp/worktrees/feat-branch",
      },
    });
    expect(result._tag).toBe("Right");
  });

  it("validates PermissionRequest with updatedPermissions (full PermissionUpdate type)", () => {
    const result = validateHookOutput({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow",
          updatedPermissions: [
            {
              type: "addRules",
              rules: [{ toolName: "Bash", ruleContent: "allow npm install" }],
              behavior: "allow",
              destination: "session",
            },
            {
              type: "setMode",
              mode: "acceptEdits",
              destination: "localSettings",
            },
          ],
        },
      },
    });
    expect(result._tag).toBe("Right");
  });

  it("rejects PermissionRequest with invalid PermissionUpdate type", () => {
    const result = validateHookOutput({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow",
          updatedPermissions: [
            {
              type: "invalidType",
              destination: "session",
            },
          ],
        },
      },
    });
    expect(result._tag).toBe("Left");
  });
});
