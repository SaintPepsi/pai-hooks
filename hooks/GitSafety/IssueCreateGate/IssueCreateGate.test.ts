import { describe, expect, it } from "bun:test";
import type { PaiError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { BlockOutput, ContinueOutput } from "@hooks/core/types/hook-outputs";
import { IssueCreateGate, type IssueCreateGateDeps } from "./IssueCreateGate.contract";

function makeDeps(overrides: Partial<IssueCreateGateDeps> = {}): IssueCreateGateDeps {
  return {
    stderr: () => {},
    ...overrides,
  };
}

function makeBashInput(command: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Bash",
    tool_input: { command },
  };
}

function makeNonBashInput(toolName: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: toolName,
    tool_input: { file_path: "/test.ts" },
  };
}

type GateResult = Result<ContinueOutput | BlockOutput, PaiError>;

describe("IssueCreateGate", () => {
  it("has correct name and event", () => {
    expect(IssueCreateGate.name).toBe("IssueCreateGate");
    expect(IssueCreateGate.event).toBe("PreToolUse");
  });

  it("accepts Bash tool inputs", () => {
    expect(IssueCreateGate.accepts(makeBashInput("git status"))).toBe(true);
  });

  it("rejects non-Bash tool inputs", () => {
    expect(IssueCreateGate.accepts(makeNonBashInput("Read"))).toBe(false);
    expect(IssueCreateGate.accepts(makeNonBashInput("Write"))).toBe(false);
    expect(IssueCreateGate.accepts(makeNonBashInput("Edit"))).toBe(false);
  });

  // ── Blocks gh issue create ──

  it("blocks gh issue create --title test", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("gh issue create --title test"),
      makeDeps(),
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("blocks gh issue create with full flags", () => {
    const result = IssueCreateGate.execute(
      makeBashInput('gh issue create --title "test" --body "body" --milestone 1'),
      makeDeps(),
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("blocks gh issue create in a chained command", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("echo 'creating' && gh issue create --title test"),
      makeDeps(),
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  // ── Blocks gh api issue creation ──

  it("blocks gh api repos/org/repo/issues -f title=test", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("gh api repos/org/repo/issues -f title=test"),
      makeDeps(),
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("blocks gh api with full org/repo/issues path", () => {
    const result = IssueCreateGate.execute(
      makeBashInput('gh api repos/my-org/my-repo/issues --method POST -f title="New issue"'),
      makeDeps(),
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  // ── Passes through unrelated commands ──

  it("passes through git status", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("git status"),
      makeDeps(),
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("passes through gh pr create", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("gh pr create --title test --body body"),
      makeDeps(),
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("passes through gh issue list", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("gh issue list --state open"),
      makeDeps(),
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("passes through gh issue view", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("gh issue view 42"),
      makeDeps(),
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("passes through gh issue close", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("gh issue close 42"),
      makeDeps(),
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("passes through gh api calls that are not issue creation", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("gh api repos/org/repo/pulls --method GET"),
      makeDeps(),
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  // ── Block message quality ──

  it("block reason mentions submit_issue", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("gh issue create --title test"),
      makeDeps(),
    ) as GateResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
    if (result.value.type !== "block") return;
    expect(result.value.reason).toContain("submit_issue");
  });

  it("logs block to stderr", () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({ stderr: (msg) => stderrMessages.push(msg) });
    IssueCreateGate.execute(makeBashInput("gh issue create --title test"), deps);
    expect(stderrMessages.some((m) => m.includes("IssueCreateGate"))).toBe(true);
  });

  it("does not log to stderr for passing commands", () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({ stderr: (msg) => stderrMessages.push(msg) });
    IssueCreateGate.execute(makeBashInput("git status"), deps);
    expect(stderrMessages).toHaveLength(0);
  });
});

describe("IssueCreateGate defaultDeps", () => {
  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => IssueCreateGate.defaultDeps.stderr("test")).not.toThrow();
  });
});
