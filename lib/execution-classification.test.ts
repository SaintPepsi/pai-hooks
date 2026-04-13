/**
 * Tests for lib/execution-classification.ts — Pure functions for command analysis.
 *
 * All functions are pure (no deps), so no injection needed.
 */

import { describe, expect, it } from "bun:test";
import {
  buildReminder,
  classifyCommand,
  hasSubstantiveOutput,
  splitCommandSegments,
} from "@hooks/lib/execution-classification";

// ─── splitCommandSegments ────────────────────────────────────────────────────

describe("splitCommandSegments", () => {
  it("returns single segment for a simple command", () => {
    expect(splitCommandSegments("git status")).toEqual(["git status"]);
  });

  it("splits on && operator", () => {
    const result = splitCommandSegments("git add . && git commit -m 'fix'");
    expect(result).toEqual(["git add .", "git commit -m 'fix'"]);
  });

  it("splits on || operator", () => {
    const result = splitCommandSegments("npm test || echo 'failed'");
    expect(result).toEqual(["npm test", "echo 'failed'"]);
  });

  it("splits on ; operator", () => {
    const result = splitCommandSegments("cd /tmp; ls");
    expect(result).toEqual(["cd /tmp", "ls"]);
  });

  it("handles mixed operators", () => {
    const result = splitCommandSegments("git add . && git commit -m 'x'; git push");
    expect(result).toHaveLength(3);
  });

  it("trims whitespace from each segment", () => {
    const result = splitCommandSegments("  ls   &&   cat file.txt  ");
    expect(result[0]).toBe("ls");
    expect(result[1]).toBe("cat file.txt");
  });

  it("filters out empty segments", () => {
    const result = splitCommandSegments(";;");
    expect(result).toEqual([]);
  });

  it("handles empty string", () => {
    expect(splitCommandSegments("")).toEqual([]);
  });
});

// ─── classifyCommand ─────────────────────────────────────────────────────────

describe("classifyCommand", () => {
  it("classifies git status as read-only", () => {
    const result = classifyCommand("git status");
    expect(result.isStateChanging).toBe(false);
    expect(result.category).toBe("read-only");
  });

  it("classifies git push as git-write", () => {
    const result = classifyCommand("git push origin main");
    expect(result.isStateChanging).toBe(true);
    expect(result.category).toBe("git-write");
  });

  it("classifies git commit as git-write", () => {
    const result = classifyCommand("git commit -m 'update'");
    expect(result.isStateChanging).toBe(true);
    expect(result.category).toBe("git-write");
  });

  it("classifies git merge as git-write", () => {
    const result = classifyCommand("git merge feature-branch");
    expect(result.isStateChanging).toBe(true);
    expect(result.category).toBe("git-write");
  });

  it("classifies npm install as package", () => {
    const result = classifyCommand("npm install lodash");
    expect(result.isStateChanging).toBe(true);
    expect(result.category).toBe("package");
  });

  it("classifies bun add as package", () => {
    const result = classifyCommand("bun add zod");
    expect(result.isStateChanging).toBe(true);
    expect(result.category).toBe("package");
  });

  it("classifies mv as file-destruction", () => {
    const result = classifyCommand("mv old.txt new.txt");
    expect(result.isStateChanging).toBe(true);
    expect(result.category).toBe("file-destruction");
  });

  it("classifies kubectl apply as deploy", () => {
    const result = classifyCommand("kubectl apply -f deployment.yaml");
    expect(result.isStateChanging).toBe(true);
    expect(result.category).toBe("deploy");
  });

  it("classifies terraform apply as deploy", () => {
    const result = classifyCommand("terraform apply");
    expect(result.isStateChanging).toBe(true);
    expect(result.category).toBe("deploy");
  });

  it("classifies curl POST as api-mutation", () => {
    const result = classifyCommand("curl -X POST https://api.example.com/data");
    expect(result.isStateChanging).toBe(true);
    expect(result.category).toBe("api-mutation");
  });

  it("classifies curl GET as read-only", () => {
    const result = classifyCommand("curl https://api.example.com/data");
    expect(result.isStateChanging).toBe(false);
    expect(result.category).toBe("read-only");
  });

  it("classifies psql as database", () => {
    const result = classifyCommand("psql -U postgres -c 'DROP TABLE foo'");
    expect(result.isStateChanging).toBe(true);
    expect(result.category).toBe("database");
  });

  it("respects dry-run flags", () => {
    const result = classifyCommand("git push --dry-run");
    expect(result.isStateChanging).toBe(false);
    expect(result.category).toBe("read-only");
  });

  it("returns state-changing if any segment is state-changing", () => {
    // git status (read-only) && git push (state-changing)
    const result = classifyCommand("git status && git push origin main");
    expect(result.isStateChanging).toBe(true);
    expect(result.category).toBe("git-write");
  });

  it("classifies cat as read-only even with deploy-sounding filename", () => {
    const result = classifyCommand("cat deploy.log");
    expect(result.isStateChanging).toBe(false);
    expect(result.category).toBe("read-only");
  });

  it("classifies echo as read-only", () => {
    const result = classifyCommand("echo hello");
    expect(result.isStateChanging).toBe(false);
    expect(result.category).toBe("read-only");
  });

  it("classifies unknown command as read-only by default", () => {
    const result = classifyCommand("my-custom-tool --flag");
    expect(result.isStateChanging).toBe(false);
    expect(result.category).toBe("read-only");
  });

  it("classifies docker push as deploy", () => {
    const result = classifyCommand("docker push my-image:latest");
    expect(result.isStateChanging).toBe(true);
    expect(result.category).toBe("deploy");
  });

  it("classifies helm install as deploy", () => {
    const result = classifyCommand("helm install my-release ./chart");
    expect(result.isStateChanging).toBe(true);
    expect(result.category).toBe("deploy");
  });
});

// ─── hasSubstantiveOutput ────────────────────────────────────────────────────

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

  it("returns false for whitespace-only string", () => {
    expect(hasSubstantiveOutput("   \n  ")).toBe(false);
  });

  it("returns false for very short output (under 50 chars)", () => {
    expect(hasSubstantiveOutput("ok")).toBe(false);
    expect(hasSubstantiveOutput("Done.")).toBe(false);
  });

  it("returns true for substantive output", () => {
    const output = "Successfully pushed to remote origin/main, 3 commits ahead of upstream.";
    expect(hasSubstantiveOutput(output)).toBe(true);
  });

  it("returns false for help block starting with Usage:", () => {
    const help = "Usage: git push [options]\nOptions:\n  --dry-run  Do not push";
    expect(hasSubstantiveOutput(help)).toBe(false);
  });

  it("returns false for help block starting with USAGE:", () => {
    const help = "USAGE: command [flags]\n  --flag   description";
    expect(hasSubstantiveOutput(help)).toBe(false);
  });

  it("converts non-string to string before checking", () => {
    // A number coerced to string is too short (e.g. "0" = 1 char)
    expect(hasSubstantiveOutput(0)).toBe(false);
    // A longer string that passes the length threshold
    const longOutput = "a".repeat(60);
    expect(hasSubstantiveOutput(longOutput)).toBe(true);
  });
});

// ─── buildReminder ───────────────────────────────────────────────────────────

describe("buildReminder", () => {
  it("includes EXECUTION EVIDENCE REQUIRED header", () => {
    const result = buildReminder("git push origin main", {
      isStateChanging: true,
      category: "git-write",
    });
    expect(result).toContain("[EXECUTION EVIDENCE REQUIRED]");
  });

  it("includes the command in the reminder", () => {
    const cmd = "git push origin main";
    const result = buildReminder(cmd, { isStateChanging: true, category: "git-write" });
    expect(result).toContain(cmd);
  });

  it("includes category-specific evidence requirement for git-write", () => {
    const result = buildReminder("git push", { isStateChanging: true, category: "git-write" });
    expect(result).toContain("Commit hash");
  });

  it("includes category-specific evidence requirement for deploy", () => {
    const result = buildReminder("kubectl apply -f app.yaml", {
      isStateChanging: true,
      category: "deploy",
    });
    expect(result).toContain("deployment log");
  });

  it("includes category-specific evidence requirement for api-mutation", () => {
    const result = buildReminder("curl -X POST /api", {
      isStateChanging: true,
      category: "api-mutation",
    });
    expect(result).toContain("HTTP status code");
  });

  it("includes category-specific evidence requirement for package", () => {
    const result = buildReminder("npm install express", {
      isStateChanging: true,
      category: "package",
    });
    expect(result).toContain("version numbers");
  });

  it("includes category-specific evidence for file-destruction", () => {
    const result = buildReminder("mv old-dir new-dir", {
      isStateChanging: true,
      category: "file-destruction",
    });
    expect(result).toContain("moved/copied/deleted");
  });

  it("truncates long commands to ~80 chars", () => {
    const longCmd = "git push " + "a".repeat(100);
    const result = buildReminder(longCmd, { isStateChanging: true, category: "git-write" });
    // The truncated command should end with ...
    expect(result).toContain("...");
  });

  it("does not truncate short commands", () => {
    const shortCmd = "git push";
    const result = buildReminder(shortCmd, { isStateChanging: true, category: "git-write" });
    expect(result).not.toContain("...");
    expect(result).toContain(shortCmd);
  });
});
