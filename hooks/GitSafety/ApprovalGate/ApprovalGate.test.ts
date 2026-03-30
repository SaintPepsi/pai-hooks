import { describe, expect, it } from "bun:test";
import type { PaiError } from "@hooks/core/error";
import { processExecFailed } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import { err, ok } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { BlockOutput, ContinueOutput } from "@hooks/core/types/hook-outputs";
import { ApprovalGate, type ApprovalGateDeps } from "./ApprovalGate.contract";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(command: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Bash",
    tool_input: { command },
  };
}

/** CI checks response: all passing */
const CI_ALL_PASSING = "[]";

/** CI checks response: one failure */
const CI_ONE_FAILURE = JSON.stringify([{ name: "tests", state: "FAILURE" }]);

/** CI checks response: one pending */
const CI_ONE_PENDING = JSON.stringify([{ name: "build", state: "PENDING" }]);

function makeDeps(opts: { ciResponse?: string | "error" } = {}): ApprovalGateDeps {
  const { ciResponse = CI_ALL_PASSING } = opts;
  return {
    exec: (cmd: string): Result<string, PaiError> => {
      if (cmd.includes("gh pr checks")) {
        if (ciResponse === "error") return err(processExecFailed(cmd, new Error("network error")));
        return ok(ciResponse);
      }
      return ok("");
    },
    stderr: () => {},
  };
}

type GateResult = Result<ContinueOutput | BlockOutput, PaiError>;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ApprovalGate", () => {
  it("has correct name and event", () => {
    expect(ApprovalGate.name).toBe("ApprovalGate");
    expect(ApprovalGate.event).toBe("PreToolUse");
  });

  it("accepts Bash tool inputs", () => {
    expect(ApprovalGate.accepts(makeInput("gh pr review 441 --approve"))).toBe(true);
  });

  it("rejects non-Bash tool inputs", () => {
    const input: ToolHookInput = {
      session_id: "test-sess",
      tool_name: "Edit",
      tool_input: { file_path: "/test.ts", old_string: "a", new_string: "b" },
    };
    expect(ApprovalGate.accepts(input)).toBe(false);
  });

  // ── Not an approve command ──

  it("continues on non-approve commands", () => {
    const deps = makeDeps();
    const result = ApprovalGate.execute(
      makeInput("gh pr review 441 --comment -b 'lgtm'"),
      deps,
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("continues on plain git commands", () => {
    const deps = makeDeps();
    const result = ApprovalGate.execute(makeInput("git commit -m 'test'"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("continues on gh pr merge commands (handled by MergeGate)", () => {
    const deps = makeDeps();
    const result = ApprovalGate.execute(makeInput("gh pr merge 441"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  // ── CI passing ──

  it("continues with verification reminder when CI passing", () => {
    const deps = makeDeps({ ciResponse: CI_ALL_PASSING });
    const result = ApprovalGate.execute(
      makeInput("gh pr review 441 --approve"),
      deps,
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
    if (result.value.type !== "continue") return;
    expect(result.value.additionalContext).toContain("Before approving PR #441");
    expect(result.value.additionalContext).toContain("bun test");
    expect(result.value.additionalContext).toContain("delegated reviewer agent");
  });

  // ── CI failing ──

  it("blocks when CI has FAILURE checks", () => {
    const deps = makeDeps({ ciResponse: CI_ONE_FAILURE });
    const result = ApprovalGate.execute(
      makeInput("gh pr review 441 --approve"),
      deps,
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
    if (result.value.type !== "block") return;
    expect(result.value.reason).toContain("APPROVAL BLOCKED");
    expect(result.value.reason).toContain("tests: FAILURE");
  });

  // ── CI pending ──

  it("continues with CI-pending warning when checks are PENDING", () => {
    const deps = makeDeps({ ciResponse: CI_ONE_PENDING });
    const result = ApprovalGate.execute(
      makeInput("gh pr review 441 --approve"),
      deps,
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
    if (result.value.type !== "continue") return;
    expect(result.value.additionalContext).toContain("CI checks are still running");
  });

  // ── Fail-open ──

  it("continues with warning when gh CLI fails", () => {
    const stderrMessages: string[] = [];
    const deps: ApprovalGateDeps = {
      exec: () => err(processExecFailed("gh", new Error("network"))),
      stderr: (msg) => {
        stderrMessages.push(msg);
      },
    };
    const result = ApprovalGate.execute(
      makeInput("gh pr review 441 --approve"),
      deps,
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
    expect(stderrMessages.some((m) => m.includes("WARNING"))).toBe(true);
  });

  // ── PR number extraction ──

  it("extracts PR number from `gh pr review 441 --approve`", () => {
    const deps = makeDeps({ ciResponse: CI_ALL_PASSING });
    const result = ApprovalGate.execute(
      makeInput("gh pr review 441 --approve"),
      deps,
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
    if (result.value.type !== "continue") return;
    expect(result.value.additionalContext).toContain("PR #441");
  });

  it("extracts PR number from `gh pr review --approve 441`", () => {
    const deps = makeDeps({ ciResponse: CI_ALL_PASSING });
    const result = ApprovalGate.execute(
      makeInput("gh pr review --approve 441"),
      deps,
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
    if (result.value.type !== "continue") return;
    expect(result.value.additionalContext).toContain("PR #441");
  });

  it("falls back to gh pr view when no PR number in command", () => {
    const deps: ApprovalGateDeps = {
      exec: (cmd: string) => {
        if (cmd.includes("gh pr view --json number")) return ok("441");
        if (cmd.includes("gh pr checks")) return ok(CI_ALL_PASSING);
        return ok("");
      },
      stderr: () => {},
    };
    const result = ApprovalGate.execute(makeInput("gh pr review --approve"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
    if (result.value.type !== "continue") return;
    expect(result.value.additionalContext).toContain("PR #441");
  });

  // ── Logs to stderr ──

  it("logs block to stderr", () => {
    const stderrMessages: string[] = [];
    const deps: ApprovalGateDeps = {
      ...makeDeps({ ciResponse: CI_ONE_FAILURE }),
      stderr: (msg) => {
        stderrMessages.push(msg);
      },
    };
    ApprovalGate.execute(makeInput("gh pr review 441 --approve"), deps);
    expect(stderrMessages.some((m) => m.includes("ApprovalGate"))).toBe(true);
  });

  it("allows approval with warning when PR number cannot be determined", () => {
    const stderrMessages: string[] = [];
    const deps: ApprovalGateDeps = {
      exec: () => err(processExecFailed("gh pr view", new Error("not a git repo"))),
      stderr: (msg) => {
        stderrMessages.push(msg);
      },
    };
    const result = ApprovalGate.execute(
      makeInput("gh pr review --approve"),
      deps,
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
    expect(stderrMessages.some((m) => m.includes("Could not determine PR number"))).toBe(true);
  });
});

describe("ApprovalGate defaultDeps", () => {
  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => ApprovalGate.defaultDeps.stderr("test")).not.toThrow();
  });
});
