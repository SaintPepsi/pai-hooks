/**
 * Type-level assertions for hook-output-helpers.
 *
 * hook-output-helpers.ts is a pure-types module with zero runtime behavior,
 * so these "tests" are compile-time assignments that force TypeScript to
 * evaluate the type aliases. If any assignment below fails to type-check,
 * `bun test` will refuse to run this file — that's the failure signal.
 *
 * Runtime `expect` calls are placeholders to satisfy the test runner;
 * the real verification is the `const _x: T = "value"` lines above them.
 */

import { describe, expect, it } from "bun:test";
import type { HookSpecificEventName, NonHookSpecificEvent } from "./hook-output-helpers";

describe("HookSpecificEventName", () => {
  it("includes every SDK event that carries a hookSpecificOutput variant", () => {
    // Compile-time assertions — each assignment only succeeds if the literal
    // is in the union extracted from SyncHookJSONOutput["hookSpecificOutput"]["hookEventName"].
    const _preToolUse: HookSpecificEventName = "PreToolUse";
    const _postToolUse: HookSpecificEventName = "PostToolUse";
    const _postToolUseFailure: HookSpecificEventName = "PostToolUseFailure";
    const _userPromptSubmit: HookSpecificEventName = "UserPromptSubmit";
    const _sessionStart: HookSpecificEventName = "SessionStart";
    const _setup: HookSpecificEventName = "Setup";
    const _subagentStart: HookSpecificEventName = "SubagentStart";
    const _notification: HookSpecificEventName = "Notification";
    const _permissionRequest: HookSpecificEventName = "PermissionRequest";
    const _permissionDenied: HookSpecificEventName = "PermissionDenied";
    const _elicitation: HookSpecificEventName = "Elicitation";
    const _elicitationResult: HookSpecificEventName = "ElicitationResult";
    const _cwdChanged: HookSpecificEventName = "CwdChanged";
    const _fileChanged: HookSpecificEventName = "FileChanged";
    const _worktreeCreate: HookSpecificEventName = "WorktreeCreate";

    // Touch each to avoid unused-var warnings
    expect([
      _preToolUse,
      _postToolUse,
      _postToolUseFailure,
      _userPromptSubmit,
      _sessionStart,
      _setup,
      _subagentStart,
      _notification,
      _permissionRequest,
      _permissionDenied,
      _elicitation,
      _elicitationResult,
      _cwdChanged,
      _fileChanged,
      _worktreeCreate,
    ]).toHaveLength(15);
  });
});

describe("NonHookSpecificEvent", () => {
  it("includes every event that CANNOT use hookSpecificOutput", () => {
    const _preCompact: NonHookSpecificEvent = "PreCompact";
    const _postCompact: NonHookSpecificEvent = "PostCompact";
    const _sessionEnd: NonHookSpecificEvent = "SessionEnd";
    const _stop: NonHookSpecificEvent = "Stop";
    const _stopFailure: NonHookSpecificEvent = "StopFailure";
    const _subagentStop: NonHookSpecificEvent = "SubagentStop";
    const _teammateIdle: NonHookSpecificEvent = "TeammateIdle";
    const _taskCreated: NonHookSpecificEvent = "TaskCreated";
    const _taskCompleted: NonHookSpecificEvent = "TaskCompleted";
    const _configChange: NonHookSpecificEvent = "ConfigChange";
    const _worktreeRemove: NonHookSpecificEvent = "WorktreeRemove";
    const _instructionsLoaded: NonHookSpecificEvent = "InstructionsLoaded";

    expect([
      _preCompact,
      _postCompact,
      _sessionEnd,
      _stop,
      _stopFailure,
      _subagentStop,
      _teammateIdle,
      _taskCreated,
      _taskCompleted,
      _configChange,
      _worktreeRemove,
      _instructionsLoaded,
    ]).toHaveLength(12);
  });
});
