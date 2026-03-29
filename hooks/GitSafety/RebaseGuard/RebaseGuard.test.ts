import { describe, expect, it } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { RebaseGuard, type RebaseGuardDeps } from "./RebaseGuard.contract";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeInput(command: string, sessionId = "test-sess"): ToolHookInput {
  return {
    session_id: sessionId,
    tool_name: "Bash",
    tool_input: { command },
  };
}

function makeDeps(): RebaseGuardDeps {
  const state = new Map<string, string>();
  return {
    stderr: () => {},
    readState: (id) => state.get(id) ?? null,
    writeState: (id, cmd) => state.set(id, cmd),
    clearState: (id) => state.delete(id),
  };
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

  // ── First attempt blocks ──

  it("blocks git rebase on first attempt", () => {
    const result = RebaseGuard.execute(makeInput("git rebase main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("blocks git rebase --onto on first attempt", () => {
    const result = RebaseGuard.execute(makeInput("git rebase --onto main feature"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("blocks git rebase -i on first attempt", () => {
    const result = RebaseGuard.execute(makeInput("git rebase -i HEAD~3"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("blocks git rebase --continue on first attempt", () => {
    const result = RebaseGuard.execute(makeInput("git rebase --continue"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("blocks git rebase --abort on first attempt", () => {
    const result = RebaseGuard.execute(makeInput("git rebase --abort"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("blocks git pull --rebase on first attempt", () => {
    const result = RebaseGuard.execute(makeInput("git pull --rebase origin main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("blocks git pull -r on first attempt", () => {
    const result = RebaseGuard.execute(makeInput("git pull -r origin main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("blocks git pull --rebase=interactive on first attempt", () => {
    const result = RebaseGuard.execute(
      makeInput("git pull --rebase=interactive origin main"),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  // ── Second attempt (same command) allows ──

  it("allows git rebase on second attempt with same command", () => {
    const deps = makeDeps();
    const cmd = "git rebase main";

    const first = RebaseGuard.execute(makeInput(cmd), deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.type).toBe("block");

    const second = RebaseGuard.execute(makeInput(cmd), deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.type).toBe("continue");
  });

  it("allows git pull --rebase on second attempt with same command", () => {
    const deps = makeDeps();
    const cmd = "git pull --rebase origin main";

    const first = RebaseGuard.execute(makeInput(cmd), deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.type).toBe("block");

    const second = RebaseGuard.execute(makeInput(cmd), deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.type).toBe("continue");
  });

  it("clears state after allowing, so third attempt blocks again", () => {
    const deps = makeDeps();
    const cmd = "git rebase main";

    RebaseGuard.execute(makeInput(cmd), deps); // block
    RebaseGuard.execute(makeInput(cmd), deps); // allow

    const third = RebaseGuard.execute(makeInput(cmd), deps);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value.type).toBe("block");
  });

  it("blocks when second attempt uses a different command", () => {
    const deps = makeDeps();

    RebaseGuard.execute(makeInput("git rebase main"), deps); // block

    const second = RebaseGuard.execute(makeInput("git rebase develop"), deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.type).toBe("block");
  });

  it("isolates state between sessions", () => {
    const deps = makeDeps();
    const cmd = "git rebase main";

    RebaseGuard.execute(makeInput(cmd, "session-a"), deps); // block session-a

    const result = RebaseGuard.execute(makeInput(cmd, "session-b"), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block"); // session-b has no prior state
  });

  // ── Block message content ──

  it("block message recommends git merge as alternative", () => {
    const result = RebaseGuard.execute(makeInput("git rebase main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "block") return;
    expect(result.value.reason).toContain("git merge");
  });

  it("block message mentions retry to confirm", () => {
    const result = RebaseGuard.execute(makeInput("git rebase main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "block") return;
    expect(result.value.reason).toContain("retry the same command");
  });

  it("block message mentions rebase is blocked", () => {
    const result = RebaseGuard.execute(makeInput("git pull --rebase"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "block") return;
    expect(result.value.reason).toContain("REBASE BLOCKED");
  });

  // ── Continues on non-rebase commands ──

  it("continues on git commit", () => {
    const result = RebaseGuard.execute(makeInput("git commit -m 'test'"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("continues on git push", () => {
    const result = RebaseGuard.execute(makeInput("git push origin feature"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("continues on git merge", () => {
    const result = RebaseGuard.execute(makeInput("git merge origin/main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("continues on git pull without rebase flag", () => {
    const result = RebaseGuard.execute(makeInput("git pull origin main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("continues on git pull --no-rebase", () => {
    const result = RebaseGuard.execute(makeInput("git pull --no-rebase origin main"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("continues on git log mentioning rebase in grep", () => {
    const result = RebaseGuard.execute(
      makeInput('git log --grep="rebase" --oneline'),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("continues when rebase appears only in heredoc body", () => {
    const cmd = 'git add file.ts && git commit -m "$(cat <<\'EOF\'\nfeat: block git rebase\nEOF\n)"';
    const result = RebaseGuard.execute(makeInput(cmd), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("continues when rebase appears only in commit message string", () => {
    const cmd = 'git commit -m "prevent git rebase operations"';
    const result = RebaseGuard.execute(makeInput(cmd), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("blocks when git rebase is chained with &&", () => {
    const cmd = "git fetch origin && git rebase origin/main";
    const result = RebaseGuard.execute(makeInput(cmd), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("continues on non-git commands", () => {
    const result = RebaseGuard.execute(makeInput("ls -la"), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  // ── Logs to stderr ──

  it("logs block to stderr", () => {
    const messages: string[] = [];
    const deps: RebaseGuardDeps = {
      ...makeDeps(),
      stderr: (msg) => messages.push(msg),
    };
    RebaseGuard.execute(makeInput("git rebase main"), deps);
    expect(messages.some((m) => m.includes("[RebaseGuard] BLOCK"))).toBe(true);
  });

  it("logs allow to stderr on retry", () => {
    const messages: string[] = [];
    const deps: RebaseGuardDeps = {
      ...makeDeps(),
      stderr: (msg) => messages.push(msg),
    };
    const cmd = "git rebase main";
    RebaseGuard.execute(makeInput(cmd), deps);
    RebaseGuard.execute(makeInput(cmd), deps);
    expect(messages.some((m) => m.includes("[RebaseGuard] ALLOW"))).toBe(true);
  });
});

describe("RebaseGuard defaultDeps", () => {
  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => RebaseGuard.defaultDeps.stderr("test")).not.toThrow();
  });
});
