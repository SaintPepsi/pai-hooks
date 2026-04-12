import { describe, expect, it } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { ExecutionEvidenceVerifier } from "@hooks/hooks/ExecutionEvidence/ExecutionEvidenceVerifier/ExecutionEvidenceVerifier.contract";
import {
  buildReminder,
  classifyCommand,
  hasSubstantiveOutput,
  splitCommandSegments,
} from "@hooks/lib/execution-classification";

// ─── Classification Tests ───────────────────────────────────────────────────

describe("classifyCommand", () => {
  // ─── Git write operations ───────────────────────────────────────────────

  it("identifies git push as state-changing", () => {
    const r = classifyCommand("git push origin main");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("git-write");
  });

  it("identifies git merge as state-changing", () => {
    const r = classifyCommand("git merge feature/auth");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("git-write");
  });

  it("identifies git commit as state-changing", () => {
    const r = classifyCommand("git commit -m 'fix: typo'");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("git-write");
  });

  it("identifies git rebase as state-changing", () => {
    const r = classifyCommand("git rebase main");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("git-write");
  });

  it("identifies git reset as state-changing", () => {
    const r = classifyCommand("git reset --hard HEAD~1");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("git-write");
  });

  it("identifies git cherry-pick as state-changing", () => {
    const r = classifyCommand("git cherry-pick abc123");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("git-write");
  });

  it("identifies git checkout -b as state-changing", () => {
    const r = classifyCommand("git checkout -b new-branch");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("git-write");
  });

  it("identifies git branch -D as state-changing", () => {
    const r = classifyCommand("git branch -D old-branch");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("git-write");
  });

  it("identifies git stash pop as state-changing", () => {
    const r = classifyCommand("git stash pop");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("git-write");
  });

  // ─── Read-only git operations ──────────────────────────────────────────

  it("identifies git log as read-only", () => {
    const r = classifyCommand("git log --oneline -10");
    expect(r.isStateChanging).toBe(false);
    expect(r.category).toBe("read-only");
  });

  it("identifies git status as read-only", () => {
    expect(classifyCommand("git status").isStateChanging).toBe(false);
  });

  it("identifies git diff as read-only", () => {
    expect(classifyCommand("git diff HEAD~1").isStateChanging).toBe(false);
  });

  it("identifies git show as read-only", () => {
    expect(classifyCommand("git show HEAD").isStateChanging).toBe(false);
  });

  it("identifies git branch (list) as read-only", () => {
    expect(classifyCommand("git branch -a").isStateChanging).toBe(false);
  });

  it("identifies git remote as read-only", () => {
    expect(classifyCommand("git remote -v").isStateChanging).toBe(false);
  });

  // ─── Deploy/infra ─────────────────────────────────────────────────────

  it("identifies kubectl apply as state-changing", () => {
    const r = classifyCommand("kubectl apply -f deployment.yaml");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("deploy");
  });

  it("identifies terraform apply as state-changing", () => {
    const r = classifyCommand("terraform apply -auto-approve");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("deploy");
  });

  it("identifies docker push as state-changing", () => {
    const r = classifyCommand("docker push myapp:latest");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("deploy");
  });

  it("identifies wrangler deploy as state-changing", () => {
    const r = classifyCommand("wrangler deploy");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("deploy");
  });

  it("identifies php artisan as state-changing", () => {
    const r = classifyCommand("php artisan make:model User");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("deploy");
  });

  // ─── API mutations ────────────────────────────────────────────────────

  it("identifies curl POST as state-changing", () => {
    const r = classifyCommand("curl -X POST https://api.example.com/users");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("api-mutation");
  });

  it("identifies curl with -d as state-changing", () => {
    const r = classifyCommand('curl -d \'{"name":"test"}\' https://api.example.com');
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("api-mutation");
  });

  it("identifies httpie POST as state-changing", () => {
    const r = classifyCommand("http POST https://api.example.com/users name=test");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("api-mutation");
  });

  it("identifies plain curl GET as read-only", () => {
    expect(classifyCommand("curl https://api.example.com/status").isStateChanging).toBe(false);
  });

  // ─── Package operations ───────────────────────────────────────────────

  it("identifies npm install as state-changing", () => {
    const r = classifyCommand("npm install express");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("package");
  });

  it("identifies bun add as state-changing", () => {
    const r = classifyCommand("bun add zod");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("package");
  });

  it("identifies pip install as state-changing", () => {
    const r = classifyCommand("pip install requests");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("package");
  });

  // ─── Database ─────────────────────────────────────────────────────────

  it("identifies psql as state-changing", () => {
    const r = classifyCommand("psql -d mydb -f schema.sql");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("database");
  });

  it("identifies artisan migrate as state-changing", () => {
    const r = classifyCommand("php artisan migrate");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("database");
  });

  // ─── File operations (mv covers file-destruction category) ────────────

  it("identifies mv as state-changing file-destruction", () => {
    const r = classifyCommand("mv old.txt new.txt");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("file-destruction");
  });

  it("identifies cp -r as state-changing file-destruction", () => {
    const r = classifyCommand("cp -r src/ dest/");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("file-destruction");
  });

  // ─── Read-only general commands ───────────────────────────────────────

  it("identifies ls as read-only", () => {
    expect(classifyCommand("ls -la").isStateChanging).toBe(false);
  });

  it("identifies cat as read-only", () => {
    expect(classifyCommand("cat file.txt").isStateChanging).toBe(false);
  });

  it("identifies grep as read-only", () => {
    expect(classifyCommand("grep -r 'pattern' src/").isStateChanging).toBe(false);
  });

  it("identifies echo as read-only", () => {
    expect(classifyCommand("echo hello").isStateChanging).toBe(false);
  });

  it("identifies which as read-only", () => {
    expect(classifyCommand("which node").isStateChanging).toBe(false);
  });

  // ─── Dry-run / help detection ─────────────────────────────────────────

  it("treats --help suffix as read-only", () => {
    expect(classifyCommand("git push --help").isStateChanging).toBe(false);
  });

  it("treats --dry-run flag as read-only", () => {
    expect(classifyCommand("git push --dry-run origin main").isStateChanging).toBe(false);
  });

  it("treats php artisan list as read-only", () => {
    expect(classifyCommand("php artisan list").isStateChanging).toBe(false);
  });

  // ─── Piped/chained commands ───────────────────────────────────────────

  it("classifies chained command if any segment is state-changing", () => {
    const r = classifyCommand("git fetch && git merge origin/main");
    expect(r.isStateChanging).toBe(true);
    expect(r.category).toBe("git-write");
  });

  it("returns read-only if all segments are read-only", () => {
    expect(classifyCommand("git status && git log --oneline -5").isStateChanging).toBe(false);
  });

  it("handles semicolon-separated commands", () => {
    expect(classifyCommand("cd /tmp; git push origin main").isStateChanging).toBe(true);
  });

  // ─── False positive prevention ────────────────────────────────────────

  it("does not match 'cat deploy.log' as deploy", () => {
    expect(classifyCommand("cat deploy.log").isStateChanging).toBe(false);
  });

  it("does not match 'echo git push' as state-changing", () => {
    expect(classifyCommand("echo git push").isStateChanging).toBe(false);
  });

  it("treats unknown commands as read-only", () => {
    expect(classifyCommand("my-custom-script --flag").isStateChanging).toBe(false);
  });
});

// ─── splitCommandSegments Tests ─────────────────────────────────────────────

describe("splitCommandSegments", () => {
  it("splits on &&", () => {
    expect(splitCommandSegments("a && b")).toEqual(["a", "b"]);
  });

  it("splits on ;", () => {
    expect(splitCommandSegments("a ; b")).toEqual(["a", "b"]);
  });

  it("splits on ||", () => {
    expect(splitCommandSegments("a || b")).toEqual(["a", "b"]);
  });

  it("handles single command", () => {
    expect(splitCommandSegments("git push")).toEqual(["git push"]);
  });

  it("handles multiple operators", () => {
    expect(splitCommandSegments("a && b ; c || d")).toEqual(["a", "b", "c", "d"]);
  });
});

// ─── hasSubstantiveOutput Tests ─────────────────────────────────────────────

describe("hasSubstantiveOutput", () => {
  it("returns false for null", () => {
    expect(hasSubstantiveOutput(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(hasSubstantiveOutput(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(hasSubstantiveOutput("")).toBe(false);
  });

  it("returns false for whitespace only", () => {
    expect(hasSubstantiveOutput("   \n  ")).toBe(false);
  });

  it("returns false for short output under threshold", () => {
    expect(hasSubstantiveOutput("ok")).toBe(false);
  });

  it("returns false for help/usage block", () => {
    expect(hasSubstantiveOutput("Usage: git push [<options>] [<remote>] [<refspec>...]")).toBe(
      false,
    );
  });

  it("returns true for substantive output", () => {
    const output =
      "To github.com:user/repo.git\n   abc1234..def5678  main -> main\nEverything up-to-date";
    expect(hasSubstantiveOutput(output)).toBe(true);
  });

  it("returns true for long output", () => {
    expect(hasSubstantiveOutput("a".repeat(100))).toBe(true);
  });

  it("handles non-string tool_response by coercing", () => {
    expect(hasSubstantiveOutput({ toString: () => "a".repeat(100) })).toBe(true);
  });
});

// ─── buildReminder Tests ────────────────────────────────────────────────────

describe("buildReminder", () => {
  it("includes command summary", () => {
    const reminder = buildReminder("git push origin main", {
      isStateChanging: true,
      category: "git-write",
    });
    expect(reminder).toContain("git push origin main");
  });

  it("includes category-specific evidence for git-write", () => {
    const reminder = buildReminder("git push origin main", {
      isStateChanging: true,
      category: "git-write",
    });
    expect(reminder).toContain("Commit hash");
  });

  it("includes deploy evidence for deploy commands", () => {
    const reminder = buildReminder("kubectl apply -f deployment.yaml", {
      isStateChanging: true,
      category: "deploy",
    });
    expect(reminder).toContain("deployment log");
  });

  it("includes API evidence for curl mutations", () => {
    const reminder = buildReminder("curl -X POST https://api.example.com", {
      isStateChanging: true,
      category: "api-mutation",
    });
    expect(reminder).toContain("HTTP status code");
  });

  it("truncates long commands to 80 chars", () => {
    const longCmd = `git push ${"a".repeat(200)}`;
    const reminder = buildReminder(longCmd, {
      isStateChanging: true,
      category: "git-write",
    });
    expect(reminder).toContain("...");
  });

  it("starts with EXECUTION EVIDENCE REQUIRED header", () => {
    const reminder = buildReminder("git push", {
      isStateChanging: true,
      category: "git-write",
    });
    expect(reminder).toMatch(/^\[EXECUTION EVIDENCE REQUIRED\]/);
  });
});

// ─── Contract Tests ─────────────────────────────────────────────────────────

describe("ExecutionEvidenceVerifier contract", () => {
  const mockDeps = { stderr: () => {} };

  function makeInput(command: string, toolResponse?: unknown): ToolHookInput {
    return {
      session_id: "test-sess",
      tool_name: "Bash",
      tool_input: { command },
      tool_response: toolResponse,
    };
  }

  it("has correct name and event", () => {
    expect(ExecutionEvidenceVerifier.name).toBe("ExecutionEvidenceVerifier");
    expect(ExecutionEvidenceVerifier.event).toBe("PostToolUse");
  });

  it("accepts Bash tool", () => {
    const input: ToolHookInput = {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    };
    expect(ExecutionEvidenceVerifier.accepts(input)).toBe(true);
  });

  it("rejects non-Bash tools", () => {
    const input: ToolHookInput = {
      session_id: "s",
      tool_name: "Write",
      tool_input: {},
    };
    expect(ExecutionEvidenceVerifier.accepts(input)).toBe(false);
  });

  it("returns continue without context for read-only commands", () => {
    const input = makeInput("git log --oneline", "abc123 fix: typo\ndef456 feat: add auth");
    const r = ExecutionEvidenceVerifier.execute(input, mockDeps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.continue).toBe(true);
      expect(r.value.hookSpecificOutput).toBeUndefined();
    }
  });

  it("returns continue without context when output is substantive", () => {
    const output = "To github.com:user/repo.git\n   abc1234..def5678  main -> main\n";
    const input = makeInput("git push origin main", output);
    const r = ExecutionEvidenceVerifier.execute(input, mockDeps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.continue).toBe(true);
      expect(r.value.hookSpecificOutput).toBeUndefined();
    }
  });

  it("injects additionalContext for thin output on state-changing command", () => {
    const input = makeInput("git push origin main", "");
    const r = ExecutionEvidenceVerifier.execute(input, mockDeps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.continue).toBe(true);
      const hso = r.value.hookSpecificOutput;
      expect(hso).toBeDefined();
      if (hso && hso.hookEventName === "PostToolUse") {
        expect(hso.additionalContext).toBeDefined();
        expect(hso.additionalContext).toContain("EXECUTION EVIDENCE REQUIRED");
        expect(hso.additionalContext).toContain("git push origin main");
      }
    }
  });

  it("injects additionalContext for null response on state-changing command", () => {
    const input = makeInput("git merge feature/auth", null);
    const r = ExecutionEvidenceVerifier.execute(input, mockDeps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;
    expect(r.ok).toBe(true);
    if (r.ok) {
      const hso = r.value.hookSpecificOutput;
      expect(hso).toBeDefined();
      if (hso && hso.hookEventName === "PostToolUse") {
        expect(hso.additionalContext).toBeDefined();
        expect(hso.additionalContext).toContain("EXECUTION EVIDENCE REQUIRED");
      }
    }
  });

  it("returns continue without context for --help on state-changing command", () => {
    const input = makeInput("git push --help", "Usage: git push ...");
    const r = ExecutionEvidenceVerifier.execute(input, mockDeps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.hookSpecificOutput).toBeUndefined();
    }
  });
});
