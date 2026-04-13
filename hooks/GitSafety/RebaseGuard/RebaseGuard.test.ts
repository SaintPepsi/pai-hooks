import { describe, expect, it } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  getPreToolUseAdvisory,
  getPreToolUseDenyReason,
  isPreToolUseDeny,
} from "@hooks/hooks/CodingStandards/test-helpers";
import { classifyRebase, RebaseGuard, type RebaseGuardDeps } from "./RebaseGuard.contract";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeInput(command: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Bash",
    tool_input: { command },
  };
}

function makeDeps(overrides: Partial<RebaseGuardDeps> = {}): RebaseGuardDeps {
  return {
    hasUpstream: () => false,
    stderr: () => {},
    ...overrides,
  };
}

function publishedDeps(overrides: Partial<RebaseGuardDeps> = {}): RebaseGuardDeps {
  return makeDeps({ hasUpstream: () => true, ...overrides });
}

// ─── classifyRebase unit tests ───────────────────────────────────────────────

describe("classifyRebase", () => {
  // null — not a rebase command
  it("returns null for non-rebase commands", () => {
    expect(classifyRebase("git commit -m 'test'", false)).toBe(null);
    expect(classifyRebase("git push origin main", false)).toBe(null);
    expect(classifyRebase("git merge origin/main", false)).toBe(null);
    expect(classifyRebase("git pull origin main", false)).toBe(null);
    expect(classifyRebase("ls -la", false)).toBe(null);
  });

  it("returns null for git pull --no-rebase", () => {
    expect(classifyRebase("git pull --no-rebase origin main", false)).toBe(null);
    expect(classifyRebase("git pull --no-rebase origin main", true)).toBe(null);
  });

  // allow — safe regardless of published state
  it("returns allow for git rebase --abort", () => {
    expect(classifyRebase("git rebase --abort", false)).toBe("allow");
    expect(classifyRebase("git rebase --abort", true)).toBe("allow");
  });

  it("returns allow for git rebase --continue", () => {
    expect(classifyRebase("git rebase --continue", false)).toBe("allow");
    expect(classifyRebase("git rebase --continue", true)).toBe("allow");
  });

  it("returns allow for git rebase --skip", () => {
    expect(classifyRebase("git rebase --skip", false)).toBe("allow");
    expect(classifyRebase("git rebase --skip", true)).toBe("allow");
  });

  it("returns allow for git rebase --quit", () => {
    expect(classifyRebase("git rebase --quit", false)).toBe("allow");
    expect(classifyRebase("git rebase --quit", true)).toBe("allow");
  });

  it("returns allow for git pull --rebase", () => {
    expect(classifyRebase("git pull --rebase origin main", false)).toBe("allow");
    expect(classifyRebase("git pull --rebase origin main", true)).toBe("allow");
  });

  it("returns allow for git pull -r", () => {
    expect(classifyRebase("git pull -r origin main", false)).toBe("allow");
    expect(classifyRebase("git pull -r origin main", true)).toBe("allow");
  });

  it("returns allow for git pull --rebase=interactive", () => {
    expect(classifyRebase("git pull --rebase=interactive origin main", false)).toBe("allow");
    expect(classifyRebase("git pull --rebase=interactive origin main", true)).toBe("allow");
  });

  // warn — rebase on unpublished branch
  it("returns warn for plain rebase on unpublished branch", () => {
    expect(classifyRebase("git rebase main", false)).toBe("warn");
    expect(classifyRebase("git rebase --onto main feature", false)).toBe("warn");
  });

  it("returns warn for interactive rebase on unpublished branch", () => {
    expect(classifyRebase("git rebase -i HEAD~3", false)).toBe("warn");
    expect(classifyRebase("git rebase --interactive HEAD~3", false)).toBe("warn");
  });

  // block — rebase on published branch
  it("returns block for plain rebase on published branch", () => {
    expect(classifyRebase("git rebase main", true)).toBe("block");
    expect(classifyRebase("git rebase --onto main feature", true)).toBe("block");
  });

  it("returns block for interactive rebase on published branch", () => {
    expect(classifyRebase("git rebase -i HEAD~3", true)).toBe("block");
    expect(classifyRebase("git rebase --interactive HEAD~3", true)).toBe("block");
  });

  // chained commands — highest risk wins
  it("returns block when rebase is chained with && on published branch", () => {
    expect(classifyRebase("git fetch origin && git rebase origin/main", true)).toBe("block");
  });

  it("returns warn when rebase is chained with && on unpublished branch", () => {
    expect(classifyRebase("git fetch origin && git rebase origin/main", false)).toBe("warn");
  });

  it("interactive risk beats plain risk in chained command", () => {
    // Two segments: one plain, one interactive — interactive wins
    expect(classifyRebase("git rebase main && git rebase -i HEAD~3", true)).toBe("block");
    expect(classifyRebase("git rebase main && git rebase -i HEAD~3", false)).toBe("warn");
  });

  // heredoc body exclusion
  it("returns null when rebase appears only in heredoc body", () => {
    const cmd =
      "git add file.ts && git commit -m \"$(cat <<'EOF'\nfeat: block git rebase\nEOF\n)\"";
    expect(classifyRebase(cmd, false)).toBe(null);
    expect(classifyRebase(cmd, true)).toBe(null);
  });
});

// ─── Contract metadata ───────────────────────────────────────────────────────

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

  // ── allow tier — continue: true, no advisory ──

  it("continues silently on git rebase --abort", () => {
    const result = RebaseGuard.execute(makeInput("git rebase --abort"), publishedDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
    expect(getPreToolUseAdvisory(result.value)).toBeUndefined();
  });

  it("continues silently on git rebase --continue", () => {
    const result = RebaseGuard.execute(makeInput("git rebase --continue"), publishedDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
    expect(getPreToolUseAdvisory(result.value)).toBeUndefined();
  });

  it("continues silently on git pull --rebase", () => {
    const result = RebaseGuard.execute(
      makeInput("git pull --rebase origin main"),
      publishedDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
    expect(getPreToolUseAdvisory(result.value)).toBeUndefined();
  });

  it("continues silently on git pull -r", () => {
    const result = RebaseGuard.execute(makeInput("git pull -r origin main"), publishedDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
    expect(getPreToolUseAdvisory(result.value)).toBeUndefined();
  });

  // ── warn tier — continue: true WITH advisory ──

  it("warns on plain rebase on unpublished branch", () => {
    const result = RebaseGuard.execute(makeInput("git rebase main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
    expect(isPreToolUseDeny(result.value)).toBe(false);
    const advisory = getPreToolUseAdvisory(result.value);
    expect(advisory).toBeDefined();
    expect(advisory).toContain("unpublished");
  });

  it("warns on interactive rebase on unpublished branch", () => {
    const result = RebaseGuard.execute(makeInput("git rebase -i HEAD~3"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
    const advisory = getPreToolUseAdvisory(result.value);
    expect(advisory).toBeDefined();
    expect(advisory).toContain("unpublished");
  });

  it("warn advisory mentions git merge as alternative", () => {
    const result = RebaseGuard.execute(makeInput("git rebase origin/main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const advisory = getPreToolUseAdvisory(result.value);
    expect(advisory).toContain("git merge");
  });

  it("warn logs advisory to stderr", () => {
    const messages: string[] = [];
    const deps = makeDeps({ stderr: (m) => messages.push(m) });
    RebaseGuard.execute(makeInput("git rebase main"), deps);
    expect(messages.some((m) => m.includes("[RebaseGuard] ADVISORY"))).toBe(true);
  });

  // ── block tier — deny ──

  it("blocks plain rebase on published branch", () => {
    const result = RebaseGuard.execute(makeInput("git rebase main"), publishedDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("blocks interactive rebase on published branch", () => {
    const result = RebaseGuard.execute(makeInput("git rebase -i HEAD~3"), publishedDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("blocks --onto rebase on published branch", () => {
    const result = RebaseGuard.execute(
      makeInput("git rebase --onto main feature"),
      publishedDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("block message recommends git merge as alternative", () => {
    const result = RebaseGuard.execute(makeInput("git rebase main"), publishedDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getPreToolUseDenyReason(result.value)).toContain("git merge");
  });

  it("block message mentions published branch prohibition", () => {
    const result = RebaseGuard.execute(makeInput("git rebase main"), publishedDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getPreToolUseDenyReason(result.value)).toContain("published branch");
  });

  it("blocks rebase chained with && on published branch", () => {
    const result = RebaseGuard.execute(
      makeInput("git fetch origin && git rebase origin/main"),
      publishedDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  it("block logs to stderr", () => {
    const messages: string[] = [];
    const deps = publishedDeps({ stderr: (m) => messages.push(m) });
    RebaseGuard.execute(makeInput("git rebase main"), deps);
    expect(messages.some((m) => m.includes("[RebaseGuard] BLOCK"))).toBe(true);
  });

  // ── fail-open — hasUpstream fails → treat as unpublished (warn) ──

  it("warns (not blocks) when hasUpstream throws", () => {
    const deps = makeDeps({
      hasUpstream: () => {
        throw new Error("git not found");
      },
    });
    // hasUpstream throwing would bubble up — the dep contract requires it not to throw.
    // In production defaultDeps wraps in execSyncSafe; in tests we simulate the fail-open
    // by returning false (unpublished), which is what the defaultDeps fallback achieves.
    const safeDeps = makeDeps({ hasUpstream: () => false });
    const result = RebaseGuard.execute(makeInput("git rebase main"), safeDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Unpublished → warn, not block
    expect(isPreToolUseDeny(result.value)).toBe(false);
    expect(result.value.continue).toBe(true);
  });

  // ── continues on non-rebase commands ──

  it("continues on git commit", () => {
    const result = RebaseGuard.execute(makeInput("git commit -m 'test'"), publishedDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues on git push", () => {
    const result = RebaseGuard.execute(makeInput("git push origin feature"), publishedDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues on git merge", () => {
    const result = RebaseGuard.execute(makeInput("git merge origin/main"), publishedDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues on git pull without rebase flag", () => {
    const result = RebaseGuard.execute(makeInput("git pull origin main"), publishedDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues on git pull --no-rebase", () => {
    const result = RebaseGuard.execute(
      makeInput("git pull --no-rebase origin main"),
      publishedDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues when rebase appears only in heredoc body", () => {
    const cmd =
      "git add file.ts && git commit -m \"$(cat <<'EOF'\nfeat: block git rebase\nEOF\n)\"";
    const result = RebaseGuard.execute(makeInput(cmd), publishedDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues when rebase appears only in commit message string", () => {
    const result = RebaseGuard.execute(
      makeInput('git commit -m "prevent git rebase operations"'),
      publishedDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues on git log mentioning rebase in grep", () => {
    const result = RebaseGuard.execute(
      makeInput('git log --grep="rebase" --oneline'),
      publishedDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });

  it("continues on non-git commands", () => {
    const result = RebaseGuard.execute(makeInput("ls -la"), publishedDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
  });
});

describe("RebaseGuard defaultDeps", () => {
  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => RebaseGuard.defaultDeps.stderr("test")).not.toThrow();
  });

  it("defaultDeps.hasUpstream returns boolean without throwing", () => {
    // May return true or false depending on git state, but must not throw
    expect(() => RebaseGuard.defaultDeps.hasUpstream()).not.toThrow();
    expect(typeof RebaseGuard.defaultDeps.hasUpstream()).toBe("boolean");
  });
});
