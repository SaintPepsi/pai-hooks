import { describe, it, expect } from "bun:test";
import {
  PreCompactStatePersist,
  parseFrontmatter,
  findMostRecentPrd,
  buildContextSummary,
  type PreCompactStatePersistDeps,
  type PRDState,
} from "@hooks/contracts/PreCompactStatePersist";
import type { PreCompactInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import type { Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { ok, err } from "@hooks/core/result";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_PRD = `---
task: Implement PreCompact hook
slug: 20260314-120000_implement-precompact-hook
phase: in-progress
progress: 3/10
mode: algorithm
started: 2026-03-14T12:00:00+11:00
updated: 2026-03-14T13:00:00+11:00
---

## Context

Some task description here.
`;

const PRD_NO_FRONTMATTER = `# Just a heading

No frontmatter here at all.
`;

const PRD_MISSING_TASK_AND_SLUG = `---
phase: complete
progress: 5/5
---

Body.
`;

// ─── Mock Dirent ─────────────────────────────────────────────────────────────

function makeDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
  };
}

// ─── Mock Deps ───────────────────────────────────────────────────────────────

function makeDeps(
  overrides: Partial<PreCompactStatePersistDeps> = {},
): PreCompactStatePersistDeps {
  return {
    readDir: (_path, _opts) =>
      ok([
        makeDirent("20260314-120000_implement-precompact-hook", true),
      ]),
    readFile: (_path) => ok(VALID_PRD),
    stat: (_path) => ok({ mtimeMs: 1000 }),
    stderr: () => {},
    baseDir: "/tmp/test",
    ...overrides,
  };
}

function makeInput(overrides: Partial<PreCompactInput> = {}): PreCompactInput {
  return {
    session_id: "test-session-abc",
    ...overrides,
  };
}

// ─── parseFrontmatter ────────────────────────────────────────────────────────

describe("parseFrontmatter", () => {
  it("extracts all standard fields from valid frontmatter", () => {
    const result = parseFrontmatter(VALID_PRD);
    expect(result).not.toBeNull();
    expect(result!["task"]).toBe("Implement PreCompact hook");
    expect(result!["slug"]).toBe("20260314-120000_implement-precompact-hook");
    expect(result!["phase"]).toBe("in-progress");
    expect(result!["progress"]).toBe("3/10");
  });

  it("returns null when no frontmatter block is present", () => {
    expect(parseFrontmatter(PRD_NO_FRONTMATTER)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseFrontmatter("")).toBeNull();
  });

  it("strips surrounding quotes from values", () => {
    const content = `---\ntask: "Quoted task"\nslug: 'quoted-slug'\n---\n`;
    const result = parseFrontmatter(content);
    expect(result!["task"]).toBe("Quoted task");
    expect(result!["slug"]).toBe("quoted-slug");
  });

  it("handles CRLF line endings", () => {
    const content = "---\r\ntask: CRLF task\r\nslug: crlf-slug\r\n---\r\n";
    const result = parseFrontmatter(content);
    expect(result!["task"]).toBe("CRLF task");
  });

  it("skips lines without a colon", () => {
    const content = `---\ntask: Valid\nno-colon-line\nslug: also-valid\n---\n`;
    const result = parseFrontmatter(content);
    expect(result!["task"]).toBe("Valid");
    expect(result!["slug"]).toBe("also-valid");
  });
});

// ─── findMostRecentPrd ───────────────────────────────────────────────────────

describe("findMostRecentPrd", () => {
  it("returns path of the PRD.md in the most recently modified directory", () => {
    const deps = {
      readDir: (_path: string, _opts?: { withFileTypes: true }) =>
        ok([
          makeDirent("older-dir", true),
          makeDirent("newer-dir", true),
        ]) as Result<unknown[], PaiError>,
      stat: (path: string) => {
        if (path.includes("newer-dir")) return ok({ mtimeMs: 2000 });
        return ok({ mtimeMs: 1000 });
      },
      stderr: () => {},
    };

    const result = findMostRecentPrd("/tmp/test/MEMORY/WORK", deps);
    expect(result).toContain("newer-dir/PRD.md");
  });

  it("returns null when readDir fails", () => {
    const deps = {
      readDir: () =>
        err({ code: "FILE_READ_FAILED", message: "cannot read" }) as Result<unknown[], PaiError>,
      stat: () => ok({ mtimeMs: 1000 }),
      stderr: () => {},
    };

    expect(findMostRecentPrd("/tmp/test/MEMORY/WORK", deps)).toBeNull();
  });

  it("returns null when no directories contain a PRD.md (stat fails for all)", () => {
    const deps = {
      readDir: () =>
        ok([makeDirent("some-dir", true)]) as Result<unknown[], PaiError>,
      stat: () =>
        err({ code: "FILE_NOT_FOUND", message: "no prd" }) as Result<{ mtimeMs: number }, PaiError>,
      stderr: () => {},
    };

    expect(findMostRecentPrd("/tmp/test/MEMORY/WORK", deps)).toBeNull();
  });

  it("skips non-directory entries", () => {
    const deps = {
      readDir: () =>
        ok([
          makeDirent("file.txt", false),
          makeDirent("dir-with-prd", true),
        ]) as Result<unknown[], PaiError>,
      stat: (path: string) => {
        if (path.includes("dir-with-prd")) return ok({ mtimeMs: 1000 });
        return err({ code: "FILE_NOT_FOUND", message: "no prd" }) as Result<{ mtimeMs: number }, PaiError>;
      },
      stderr: () => {},
    };

    const result = findMostRecentPrd("/tmp/test/MEMORY/WORK", deps);
    expect(result).toContain("dir-with-prd/PRD.md");
  });

  it("skips entries that do not have isDirectory function", () => {
    const deps = {
      readDir: () =>
        ok([
          { name: "bad-entry" },  // missing isDirectory
          makeDirent("good-dir", true),
        ]) as Result<unknown[], PaiError>,
      stat: () => ok({ mtimeMs: 1000 }),
      stderr: () => {},
    };

    const result = findMostRecentPrd("/tmp/test/MEMORY/WORK", deps);
    expect(result).toContain("good-dir/PRD.md");
  });
});

// ─── buildContextSummary ─────────────────────────────────────────────────────

describe("buildContextSummary", () => {
  it("includes all PRD state fields in the summary", () => {
    const state: PRDState = {
      task: "My task",
      slug: "20260314-120000_my-task",
      phase: "in-progress",
      progress: "4/8",
    };
    const summary = buildContextSummary(state);
    expect(summary).toContain("My task");
    expect(summary).toContain("20260314-120000_my-task");
    expect(summary).toContain("in-progress");
    expect(summary).toContain("4/8");
  });

  it("includes the PreCompact prefix label", () => {
    const state: PRDState = { task: "T", slug: "S", phase: "P", progress: "1/1" };
    expect(buildContextSummary(state)).toContain("[PreCompact]");
  });
});

// ─── PreCompactStatePersist contract ─────────────────────────────────────────

describe("PreCompactStatePersist", () => {
  it("has correct name and event", () => {
    expect(PreCompactStatePersist.name).toBe("PreCompactStatePersist");
    expect(PreCompactStatePersist.event).toBe("PreCompact");
  });

  it("always accepts any input", () => {
    expect(PreCompactStatePersist.accepts(makeInput())).toBe(true);
    expect(PreCompactStatePersist.accepts({ session_id: "" })).toBe(true);
  });

  describe("execute — PRD found", () => {
    it("returns continue with additionalContext when PRD exists and has frontmatter", () => {
      const deps = makeDeps();
      const result = PreCompactStatePersist.execute(makeInput(), deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.continue).toBe(true);
        expect(result.value.additionalContext).toBeDefined();
        expect(result.value.additionalContext).toContain("Implement PreCompact hook");
        expect(result.value.additionalContext).toContain("in-progress");
        expect(result.value.additionalContext).toContain("3/10");
      }
    });

    it("additionalContext includes the slug", () => {
      const deps = makeDeps();
      const result = PreCompactStatePersist.execute(makeInput(), deps) as Result<ContinueOutput, PaiError>;
      if (result.ok) {
        expect(result.value.additionalContext).toContain("20260314-120000_implement-precompact-hook");
      }
    });
  });

  describe("execute — no PRD found (fail open)", () => {
    it("returns continue with no additionalContext when readDir fails", () => {
      const deps = makeDeps({
        readDir: () => err({ code: "FILE_READ_FAILED", message: "no dir" }) as Result<unknown[], PaiError>,
      });
      const result = PreCompactStatePersist.execute(makeInput(), deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.additionalContext).toBeUndefined();
      }
    });

    it("returns continue with no additionalContext when no PRD.md files exist", () => {
      const deps = makeDeps({
        readDir: () => ok([makeDirent("some-dir", true)]) as Result<unknown[], PaiError>,
        stat: () => err({ code: "FILE_NOT_FOUND", message: "no prd" }) as Result<{ mtimeMs: number }, PaiError>,
      });
      const result = PreCompactStatePersist.execute(makeInput(), deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toBeUndefined();
      }
    });

    it("fails open when readFile throws an error", () => {
      const deps = makeDeps({
        readFile: () => err({ code: "FILE_READ_FAILED", message: "read error" }) as Result<string, PaiError>,
      });
      const result = PreCompactStatePersist.execute(makeInput(), deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.additionalContext).toBeUndefined();
      }
    });

    it("fails open when PRD has no frontmatter", () => {
      const deps = makeDeps({
        readFile: () => ok(PRD_NO_FRONTMATTER),
      });
      const result = PreCompactStatePersist.execute(makeInput(), deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toBeUndefined();
      }
    });

    it("fails open when frontmatter has no task or slug", () => {
      const deps = makeDeps({
        readFile: () => ok(PRD_MISSING_TASK_AND_SLUG),
      });
      const result = PreCompactStatePersist.execute(makeInput(), deps) as Result<ContinueOutput, PaiError>;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toBeUndefined();
      }
    });
  });

  describe("execute — never blocks", () => {
    it("never returns a block type under any circumstances", () => {
      const scenarios: PreCompactStatePersistDeps[] = [
        makeDeps(),
        makeDeps({ readDir: () => err({ code: "FILE_READ_FAILED", message: "x" }) as Result<unknown[], PaiError> }),
        makeDeps({ readFile: () => err({ code: "FILE_READ_FAILED", message: "x" }) as Result<string, PaiError> }),
        makeDeps({ readFile: () => ok(PRD_NO_FRONTMATTER) }),
      ];

      for (const deps of scenarios) {
        const result = PreCompactStatePersist.execute(makeInput(), deps) as Result<ContinueOutput, PaiError>;
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.type).toBe("continue");
        }
      }
    });
  });
});
