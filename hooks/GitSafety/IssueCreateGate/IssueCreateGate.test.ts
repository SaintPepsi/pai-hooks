import { describe, expect, it } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  getPreToolUseDenyReason,
  isPreToolUseDeny,
} from "@hooks/hooks/CodingStandards/test-helpers";
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
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("blocks gh issue create with full flags", () => {
    const result = IssueCreateGate.execute(
      makeBashInput('gh issue create --title "test" --body "body" --milestone 1'),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("blocks gh issue create in a chained command", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("echo 'creating' && gh issue create --title test"),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  // ── Blocks gh api issue creation ──

  it("blocks gh api repos/org/repo/issues -f title=test", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("gh api repos/org/repo/issues -f title=test"),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("blocks gh api with full org/repo/issues path", () => {
    const result = IssueCreateGate.execute(
      makeBashInput('gh api repos/my-org/my-repo/issues --method POST -f title="New issue"'),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  // ── Passes through unrelated commands ──

  it("passes through git status", () => {
    const result = IssueCreateGate.execute(makeBashInput("git status"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("passes through gh pr create", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("gh pr create --title test --body body"),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("passes through gh issue list", () => {
    const result = IssueCreateGate.execute(makeBashInput("gh issue list --state open"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("passes through gh issue view", () => {
    const result = IssueCreateGate.execute(makeBashInput("gh issue view 42"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("passes through gh issue close", () => {
    const result = IssueCreateGate.execute(makeBashInput("gh issue close 42"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("passes through gh api calls that are not issue creation", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("gh api repos/org/repo/pulls --method GET"),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  // ── Block message quality ──

  it("block reason mentions submit_issue", () => {
    const result = IssueCreateGate.execute(
      makeBashInput("gh issue create --title test"),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
    expect(getPreToolUseDenyReason(result.value)).toContain("submit_issue");
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
