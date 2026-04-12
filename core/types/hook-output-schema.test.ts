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
import { validateHookOutput, validateOutputSemantics } from "./hook-output-schema";

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

// ─── validateOutputSemantics ─────────────────────────────────────────────────

describe("validateOutputSemantics", () => {
  // ── Contradiction 1: continue:true + decision:block ──────────────────────
  it("flags continue:true with decision:block", () => {
    expect(
      validateOutputSemantics({ continue: true, decision: "block", reason: "bad" }),
    ).toBe("continue:true and decision:block are mutually exclusive");
  });

  it("returns null for continue:true with decision:approve", () => {
    expect(validateOutputSemantics({ continue: true, decision: "approve" })).toBeNull();
  });

  // ── Contradiction 2: decision:block without reason ───────────────────────
  it("flags decision:block without reason", () => {
    expect(validateOutputSemantics({ decision: "block" })).toBe(
      "decision:block requires a reason",
    );
  });

  it("returns null for decision:block with reason", () => {
    expect(validateOutputSemantics({ decision: "block", reason: "dangerous" })).toBeNull();
  });

  // ── Contradiction 3: continue:true + stopReason ──────────────────────────
  it("flags continue:true with stopReason present", () => {
    expect(validateOutputSemantics({ continue: true, stopReason: "done" })).toBe(
      "continue:true and stopReason are mutually exclusive",
    );
  });

  it("returns null for continue:true without stopReason", () => {
    expect(validateOutputSemantics({ continue: true })).toBeNull();
  });

  // ── Contradiction 4: PreToolUse permissionDecision:deny + continue:true ──
  it("flags PreToolUse permissionDecision:deny with continue:true", () => {
    expect(
      validateOutputSemantics({
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      }),
    ).toBe("PreToolUse permissionDecision:deny should not set continue:true");
  });

  it("returns null for PreToolUse permissionDecision:allow with continue:true", () => {
    expect(
      validateOutputSemantics({
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      }),
    ).toBeNull();
  });

  it("returns null for PostToolUse with continue:true (no PreToolUse deny)", () => {
    expect(
      validateOutputSemantics({
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
        },
      }),
    ).toBeNull();
  });

  // ── Valid combinations ────────────────────────────────────────────────────
  it("returns null for empty output", () => {
    expect(validateOutputSemantics({})).toBeNull();
  });

  it("returns null for continue:false with decision:block and reason", () => {
    expect(
      validateOutputSemantics({ continue: false, decision: "block", reason: "blocked" }),
    ).toBeNull();
  });
});
