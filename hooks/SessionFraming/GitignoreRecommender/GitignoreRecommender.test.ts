import { describe, test, expect } from "bun:test";
import { GitignoreRecommender, type GitignoreRecommenderDeps } from "@hooks/contracts/GitignoreRecommender";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import type { Result } from "@hooks/core/result";
import { ok, err } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { fileNotFound } from "@hooks/core/error";

const PAI_ROOT = "/Users/hogers/.claude";
const PROJECT_DIR = "/Users/hogers/Projects/my-app";

const baseInput: SessionStartInput = {
  session_id: "test-session-123",
};

function makeDeps(overrides: Partial<GitignoreRecommenderDeps> = {}): GitignoreRecommenderDeps {
  return {
    fileExists: () => false,
    readFile: (path) => err(fileNotFound(path)),
    cwd: () => PROJECT_DIR,
    paiRoot: PAI_ROOT,
    stderr: () => {},
    ...overrides,
  };
}

describe("GitignoreRecommender", () => {
  test("has correct name and event", () => {
    expect(GitignoreRecommender.name).toBe("GitignoreRecommender");
    expect(GitignoreRecommender.event).toBe("SessionStart");
  });

  test("accepts all SessionStart inputs", () => {
    expect(GitignoreRecommender.accepts(baseInput)).toBe(true);
  });

  describe("skips when in ~/.claude directory", () => {
    test("returns continue with no additionalContext when cwd is paiRoot", () => {
      const deps = makeDeps({ cwd: () => PAI_ROOT });
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.continue).toBe(true);
        expect(result.value.additionalContext).toBeUndefined();
      }
    });
  });

  describe("skips when respectGitignore already in settings.json", () => {
    test("returns continue with no additionalContext", () => {
      const settingsPath = `${PROJECT_DIR}/.claude/settings.json`;
      const deps = makeDeps({
        fileExists: (path) => path === settingsPath,
        readFile: (path) => {
          if (path === settingsPath) return ok(JSON.stringify({ respectGitignore: true }));
          return err(fileNotFound(path));
        },
      });
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.additionalContext).toBeUndefined();
      }
    });

    test("does not skip when respectGitignore is false in settings.json", () => {
      const settingsPath = `${PROJECT_DIR}/.claude/settings.json`;
      const deps = makeDeps({
        fileExists: (path) => path === settingsPath,
        readFile: (path) => {
          if (path === settingsPath) return ok(JSON.stringify({ respectGitignore: false }));
          return err(fileNotFound(path));
        },
      });
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toBeDefined();
      }
    });
  });

  describe("skips when respectGitignore already in settings.local.json", () => {
    test("returns continue with no additionalContext", () => {
      const localPath = `${PROJECT_DIR}/.claude/settings.local.json`;
      const deps = makeDeps({
        fileExists: (path) => path === localPath,
        readFile: (path) => {
          if (path === localPath) return ok(JSON.stringify({ respectGitignore: true }));
          return err(fileNotFound(path));
        },
      });
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.additionalContext).toBeUndefined();
      }
    });

    test("checks local even when settings.json exists without the flag", () => {
      const settingsPath = `${PROJECT_DIR}/.claude/settings.json`;
      const localPath = `${PROJECT_DIR}/.claude/settings.local.json`;
      const deps = makeDeps({
        fileExists: (path) => path === settingsPath || path === localPath,
        readFile: (path) => {
          if (path === settingsPath) return ok(JSON.stringify({ someOtherSetting: true }));
          if (path === localPath) return ok(JSON.stringify({ respectGitignore: true }));
          return err(fileNotFound(path));
        },
      });
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toBeUndefined();
      }
    });
  });

  describe("returns additionalContext when neither file has it", () => {
    test("injects recommendation when no .claude directory exists", () => {
      const deps = makeDeps();
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.continue).toBe(true);
        expect(result.value.additionalContext).toBeDefined();
        expect(result.value.additionalContext).toContain("respectGitignore");
        expect(result.value.additionalContext).toContain("settings.local.json");
      }
    });

    test("recommendation mentions .env and credentials", () => {
      const deps = makeDeps();
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toContain(".env");
        expect(result.value.additionalContext).toContain("credentials");
      }
    });

    test("injects recommendation when both files exist but lack the flag", () => {
      const settingsPath = `${PROJECT_DIR}/.claude/settings.json`;
      const localPath = `${PROJECT_DIR}/.claude/settings.local.json`;
      const deps = makeDeps({
        fileExists: (path) => path === settingsPath || path === localPath,
        readFile: (path) => {
          if (path === settingsPath) return ok(JSON.stringify({ model: "claude-opus-4-5" }));
          if (path === localPath) return ok(JSON.stringify({ theme: "dark" }));
          return err(fileNotFound(path));
        },
      });
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toBeDefined();
      }
    });
  });

  describe("fails open on read errors", () => {
    test("continues without context when readFile fails for settings.json", () => {
      const settingsPath = `${PROJECT_DIR}/.claude/settings.json`;
      const deps = makeDeps({
        fileExists: (path) => path === settingsPath,
        readFile: (_path) => err(fileNotFound(_path)),
      });
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      // Fails open: injects recommendation (treats unreadable as not set)
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.continue).toBe(true);
      }
    });

    test("continues when settings.json contains invalid JSON", () => {
      const settingsPath = `${PROJECT_DIR}/.claude/settings.json`;
      const deps = makeDeps({
        fileExists: (path) => path === settingsPath,
        readFile: (path) => {
          if (path === settingsPath) return ok("{ not valid json }}}");
          return err(fileNotFound(path));
        },
      });
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
      }
    });
  });
});
