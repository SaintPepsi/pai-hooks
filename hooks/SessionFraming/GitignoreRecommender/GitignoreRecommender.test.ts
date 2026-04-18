import { describe, expect, test } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { ResultError } from "@hooks/core/error";
import { fileNotFound } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import { err, ok } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { getInjectedContextFor } from "@hooks/lib/test-helpers";
import {
  GitignoreRecommender,
  type GitignoreRecommenderDeps,
} from "./GitignoreRecommender.contract";

const getInjectedContext = (output: SyncHookJSONOutput) =>
  getInjectedContextFor(output, "SessionStart");

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
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<
        SyncHookJSONOutput,
        ResultError
      >;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.continue).toBe(true);
        expect(getInjectedContext(result.value)).toBeUndefined();
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
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<
        SyncHookJSONOutput,
        ResultError
      >;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(getInjectedContext(result.value)).toBeUndefined();
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
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<
        SyncHookJSONOutput,
        ResultError
      >;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(getInjectedContext(result.value)).toBeDefined();
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
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<
        SyncHookJSONOutput,
        ResultError
      >;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(getInjectedContext(result.value)).toBeUndefined();
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
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<
        SyncHookJSONOutput,
        ResultError
      >;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(getInjectedContext(result.value)).toBeUndefined();
      }
    });
  });

  describe("returns additionalContext when neither file has it", () => {
    test("injects recommendation when no .claude directory exists", () => {
      const deps = makeDeps();
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<
        SyncHookJSONOutput,
        ResultError
      >;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.continue).toBe(true);
        expect(getInjectedContext(result.value)).toBeDefined();
        expect(getInjectedContext(result.value) ?? "").toContain("respectGitignore");
        expect(getInjectedContext(result.value) ?? "").toContain("settings.local.json");
      }
    });

    test("recommendation mentions .env and credentials", () => {
      const deps = makeDeps();
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<
        SyncHookJSONOutput,
        ResultError
      >;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(getInjectedContext(result.value) ?? "").toContain(".env");
        expect(getInjectedContext(result.value) ?? "").toContain("credentials");
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
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<
        SyncHookJSONOutput,
        ResultError
      >;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(getInjectedContext(result.value)).toBeDefined();
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
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<
        SyncHookJSONOutput,
        ResultError
      >;
      expect(result.ok).toBe(true);
      // Fails open: injects recommendation (treats unreadable as not set)
      if (result.ok) {
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
      const result = GitignoreRecommender.execute(baseInput, deps) as Result<
        SyncHookJSONOutput,
        ResultError
      >;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.continue).toBe(true);
      }
    });
  });
});
