import { describe, expect, it } from "bun:test";
import type { PaiError } from "@hooks/core/error";
import { processExecFailed } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import { err, ok } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { BlockOutput, ContinueOutput } from "@hooks/core/types/hook-outputs";
import { MergeGate, type MergeGateDeps } from "./MergeGate.contract";

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

/** Reviews response: one approved */
const REVIEWS_ONE_APPROVED = JSON.stringify([
  { author: { login: "reviewer1" }, state: "APPROVED" },
]);

/** Reviews response: only commented */
const REVIEWS_ONLY_COMMENTED = JSON.stringify([
  { author: { login: "reviewer1" }, state: "COMMENTED" },
]);

/** Reviews response: none */
const REVIEWS_NONE: string = "[]";

/**
 * Build mock deps that respond to specific gh CLI commands.
 * ciResponse: stdout for `gh pr checks`
 * reviewResponse: stdout for `gh pr view`
 */
function makeDeps(
  opts: { ciResponse?: string | "error"; reviewResponse?: string | "error" } = {},
): MergeGateDeps {
  const { ciResponse = CI_ALL_PASSING, reviewResponse = REVIEWS_ONE_APPROVED } = opts;
  return {
    exec: (cmd: string): Result<string, PaiError> => {
      if (cmd.includes("gh pr checks")) {
        if (ciResponse === "error") return err(processExecFailed(cmd, new Error("network error")));
        return ok(ciResponse);
      }
      if (cmd.includes("gh pr view")) {
        if (reviewResponse === "error")
          return err(processExecFailed(cmd, new Error("network error")));
        return ok(reviewResponse);
      }
      return ok("");
    },
    stderr: () => {},
  };
}

type GateResult = Result<ContinueOutput | BlockOutput, PaiError>;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MergeGate", () => {
  it("has correct name and event", () => {
    expect(MergeGate.name).toBe("MergeGate");
    expect(MergeGate.event).toBe("PreToolUse");
  });

  it("accepts Bash tool inputs", () => {
    expect(MergeGate.accepts(makeInput("gh pr merge 441"))).toBe(true);
  });

  it("rejects non-Bash tool inputs", () => {
    const input: ToolHookInput = {
      session_id: "test-sess",
      tool_name: "Edit",
      tool_input: { file_path: "/test.ts", old_string: "a", new_string: "b" },
    };
    expect(MergeGate.accepts(input)).toBe(false);
  });

  // ── Not a merge command ──

  it("continues on non-merge commands", () => {
    const deps = makeDeps();
    const result = MergeGate.execute(makeInput("gh pr list"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("continues on plain git commands", () => {
    const deps = makeDeps();
    const result = MergeGate.execute(makeInput("git commit -m 'test'"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  // ── Happy path ──

  it("continues when CI passing and review approved", () => {
    const deps = makeDeps({
      ciResponse: CI_ALL_PASSING,
      reviewResponse: REVIEWS_ONE_APPROVED,
    });
    const result = MergeGate.execute(makeInput("gh pr merge 441 --squash"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  // ── CI failing ──

  it("blocks when CI has FAILURE checks", () => {
    const deps = makeDeps({
      ciResponse: CI_ONE_FAILURE,
      reviewResponse: REVIEWS_ONE_APPROVED,
    });
    const result = MergeGate.execute(makeInput("gh pr merge 441"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
    if (result.value.type !== "block") return;
    expect(result.value.reason).toContain("CI checks are not passing");
    expect(result.value.reason).toContain("tests: FAILURE");
  });

  // ── CI pending ──

  it("blocks when CI has PENDING checks", () => {
    const deps = makeDeps({
      ciResponse: CI_ONE_PENDING,
      reviewResponse: REVIEWS_ONE_APPROVED,
    });
    const result = MergeGate.execute(makeInput("gh pr merge 441"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
    if (result.value.type !== "block") return;
    expect(result.value.reason).toContain("CI checks are not passing");
    expect(result.value.reason).toContain("build: PENDING");
  });

  // ── No approved review ──

  it("blocks when no APPROVED reviews exist", () => {
    const deps = makeDeps({
      ciResponse: CI_ALL_PASSING,
      reviewResponse: REVIEWS_ONLY_COMMENTED,
    });
    const result = MergeGate.execute(makeInput("gh pr merge 441"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
    if (result.value.type !== "block") return;
    expect(result.value.reason).toContain("No approving review found");
    expect(result.value.reason).toContain("COMMENTED reviews do not count");
  });

  it("blocks when zero reviews exist", () => {
    const deps = makeDeps({
      ciResponse: CI_ALL_PASSING,
      reviewResponse: REVIEWS_NONE,
    });
    const result = MergeGate.execute(makeInput("gh pr merge 441"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
    if (result.value.type !== "block") return;
    expect(result.value.reason).toContain("No approving review found");
  });

  // ── Both bad ──

  it("blocks mentioning both CI and review when both are bad", () => {
    const deps = makeDeps({
      ciResponse: CI_ONE_FAILURE,
      reviewResponse: REVIEWS_ONLY_COMMENTED,
    });
    const result = MergeGate.execute(makeInput("gh pr merge 441"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
    if (result.value.type !== "block") return;
    expect(result.value.reason).toContain("CI checks are not passing");
    expect(result.value.reason).toContain("No approving review found");
  });

  // ── Fail-open ──

  it("continues with warning when gh CLI fails for CI check", () => {
    const stderrMessages: string[] = [];
    const deps: MergeGateDeps = {
      exec: () => err(processExecFailed("gh", new Error("network"))),
      stderr: (msg) => {
        stderrMessages.push(msg);
      },
    };
    const result = MergeGate.execute(makeInput("gh pr merge 441"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
    expect(stderrMessages.some((m) => m.includes("WARNING"))).toBe(true);
  });

  it("continues with warning when gh CLI fails for review check", () => {
    const stderrMessages: string[] = [];
    const deps: MergeGateDeps = {
      exec: (cmd: string) => {
        if (cmd.includes("gh pr checks")) return ok(CI_ALL_PASSING);
        return err(processExecFailed("gh", new Error("network")));
      },
      stderr: (msg) => {
        stderrMessages.push(msg);
      },
    };
    const result = MergeGate.execute(makeInput("gh pr merge 441"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
    expect(stderrMessages.some((m) => m.includes("WARNING"))).toBe(true);
  });

  // ── PR number extraction ──

  it("extracts PR number from `gh pr merge 441`", () => {
    const deps = makeDeps({ ciResponse: CI_ALL_PASSING, reviewResponse: REVIEWS_ONE_APPROVED });
    const result = MergeGate.execute(makeInput("gh pr merge 441"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("extracts PR number from `gh pr merge --squash 441`", () => {
    const deps = makeDeps({ ciResponse: CI_ALL_PASSING, reviewResponse: REVIEWS_ONE_APPROVED });
    const result = MergeGate.execute(makeInput("gh pr merge --squash 441"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("falls back to gh pr view when no PR number in command", () => {
    const deps: MergeGateDeps = {
      exec: (cmd: string) => {
        if (cmd.includes("gh pr view --json number")) return ok("441");
        if (cmd.includes("gh pr checks")) return ok(CI_ALL_PASSING);
        if (cmd.includes("gh pr view")) return ok(REVIEWS_ONE_APPROVED);
        return ok("");
      },
      stderr: () => {},
    };
    const result = MergeGate.execute(makeInput("gh pr merge --squash"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("allows merge with warning when PR number cannot be determined", () => {
    const stderrMessages: string[] = [];
    const deps: MergeGateDeps = {
      exec: () => err(processExecFailed("gh pr view", new Error("not a git repo"))),
      stderr: (msg) => {
        stderrMessages.push(msg);
      },
    };
    const result = MergeGate.execute(makeInput("gh pr merge --squash"), deps) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
    expect(stderrMessages.some((m) => m.includes("Could not determine PR number"))).toBe(true);
  });

  // ── Logs to stderr ──

  it("logs block reason to stderr", () => {
    const stderrMessages: string[] = [];
    const deps: MergeGateDeps = {
      ...makeDeps({ ciResponse: CI_ONE_FAILURE, reviewResponse: REVIEWS_ONE_APPROVED }),
      stderr: (msg) => {
        stderrMessages.push(msg);
      },
    };
    MergeGate.execute(makeInput("gh pr merge 441"), deps);
    expect(stderrMessages.some((m) => m.includes("MergeGate"))).toBe(true);
  });
});

describe("MergeGate defaultDeps", () => {
  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => MergeGate.defaultDeps.stderr("test")).not.toThrow();
  });
});
