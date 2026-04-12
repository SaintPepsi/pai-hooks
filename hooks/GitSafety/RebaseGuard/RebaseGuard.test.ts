import { describe, expect, it } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  getPreToolUseDenyReason,
  isPreToolUseDeny,
} from "@hooks/hooks/CodingStandards/test-helpers";
import { RebaseGuard, type RebaseGuardDeps } from "./RebaseGuard.contract";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeInput(command: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Bash",
    tool_input: { command },
  };
}

function makeDeps(): RebaseGuardDeps {
  return { stderr: () => {} };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("RebaseGuard", () => {
  it("has correct name and event", () => {
    expect(RebaseGuard.name).toBe("RebaseGuard");
    expect(RebaseGuard.event).toBe("PreToolUse");
  });

  it("accepts Bash tool inputs", () => {
    expect(RebaseGuard.accepts(makeInput("git rebase main"))).toBe(true);
  });

  it("rejects non-Bash tool inputs", () => {
    const input: ToolHookInput = {
      session_id: "test-sess",
      tool_name: "Edit",
      tool_input: { file_path: "/test.ts", old_string: "a", new_string: "b" },
    };
    expect(RebaseGuard.accepts(input)).toBe(false);
  });

  // ── Blocks rebase commands ──

  it("blocks git rebase", () => {
    const result = RebaseGuard.execute(makeInput("git rebase main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("blocks git rebase --onto", () => {
    const result = RebaseGuard.execute(makeInput("git rebase --onto main feature"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("blocks git rebase -i (interactive)", () => {
    const result = RebaseGuard.execute(makeInput("git rebase -i HEAD~3"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("blocks git rebase --continue", () => {
    const result = RebaseGuard.execute(makeInput("git rebase --continue"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("blocks git rebase --abort", () => {
    const result = RebaseGuard.execute(makeInput("git rebase --abort"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("blocks git pull --rebase", () => {
    const result = RebaseGuard.execute(makeInput("git pull --rebase origin main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("blocks git pull -r", () => {
    const result = RebaseGuard.execute(makeInput("git pull -r origin main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("blocks git pull --rebase=interactive", () => {
    const result = RebaseGuard.execute(
      makeInput("git pull --rebase=interactive origin main"),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("blocks git rebase chained with &&", () => {
    const result = RebaseGuard.execute(
      makeInput("git fetch origin && git rebase origin/main"),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  // ── Block message content ──

  it("block message recommends git merge as alternative", () => {
    const result = RebaseGuard.execute(makeInput("git rebase main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getPreToolUseDenyReason(result.value)).toContain("git merge");
  });

  it("block message states rebase is permanently prohibited", () => {
    const result = RebaseGuard.execute(makeInput("git rebase main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getPreToolUseDenyReason(result.value)).toContain("permanently prohibited");
  });

  // ── Continues on non-rebase commands ──

  it("continues on git commit", () => {
    const result = RebaseGuard.execute(makeInput("git commit -m 'test'"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues on git push", () => {
    const result = RebaseGuard.execute(makeInput("git push origin feature"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues on git merge", () => {
    const result = RebaseGuard.execute(makeInput("git merge origin/main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues on git pull without rebase flag", () => {
    const result = RebaseGuard.execute(makeInput("git pull origin main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues on git pull --no-rebase", () => {
    const result = RebaseGuard.execute(makeInput("git pull --no-rebase origin main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues when rebase appears only in heredoc body", () => {
    const cmd =
      "git add file.ts && git commit -m \"$(cat <<'EOF'\nfeat: block git rebase\nEOF\n)\"";
    const result = RebaseGuard.execute(makeInput(cmd), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues when rebase appears only in commit message string", () => {
    const result = RebaseGuard.execute(
      makeInput('git commit -m "prevent git rebase operations"'),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues on git log mentioning rebase in grep", () => {
    const result = RebaseGuard.execute(makeInput('git log --grep="rebase" --oneline'), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues on non-git commands", () => {
    const result = RebaseGuard.execute(makeInput("ls -la"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  // ── Always blocks, even on repeated attempts ──

  it("blocks on every attempt, not just the first", () => {
    const deps = makeDeps();
    const cmd = "git rebase main";

    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = RebaseGuard.execute(makeInput(cmd), deps);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(isPreToolUseDeny(result.value)).toBe(true);
    }
  });

  // ── Logs to stderr ──

  it("logs block to stderr", () => {
    const messages: string[] = [];
    const deps: RebaseGuardDeps = { stderr: (msg) => messages.push(msg) };
    RebaseGuard.execute(makeInput("git rebase main"), deps);
    expect(messages.some((m) => m.includes("[RebaseGuard] BLOCK"))).toBe(true);
  });
});

describe("RebaseGuard defaultDeps", () => {
  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => RebaseGuard.defaultDeps.stderr("test")).not.toThrow();
  });
});
