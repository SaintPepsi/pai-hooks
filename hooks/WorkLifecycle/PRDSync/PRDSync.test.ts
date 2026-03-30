import { describe, expect, test } from "bun:test";
import type { PaiError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import { ok } from "@hooks/core/result";
import { fileReadFailed } from "@hooks/core/error";
import { err } from "@hooks/core/result";
import type { PRDSyncDeps } from "@hooks/hooks/WorkLifecycle/PRDSync/PRDSync.contract";
import {
  extractSessionDir,
  PRDSync,
  parseCriteriaCounts,
  parseFrontmatter,
} from "@hooks/hooks/WorkLifecycle/PRDSync/PRDSync.contract";

// ─── extractSessionDir ─────────────────────────────────────────────────────

describe("extractSessionDir", () => {
  test("extracts first directory after MEMORY/WORK/ from direct PRD path", () => {
    const path = "/Users/test/.claude/MEMORY/WORK/20260315-155100_my-task/PRD.md";
    expect(extractSessionDir(path)).toBe("20260315-155100_my-task");
  });

  test("extracts first directory from nested PRD path (tasks subdirectory)", () => {
    const path = "/Users/test/.claude/MEMORY/WORK/20260315-045122_some-slug/tasks/001_task/PRD.md";
    expect(extractSessionDir(path)).toBe("20260315-045122_some-slug");
  });

  test("returns null for paths not containing MEMORY/WORK/", () => {
    expect(extractSessionDir("/tmp/some/other/PRD.md")).toBeNull();
  });

  test("returns null for path ending at MEMORY/WORK/ with no directory after", () => {
    expect(extractSessionDir("/Users/test/.claude/MEMORY/WORK/PRD.md")).toBeNull();
  });

  test("handles paths with trailing slashes in directory name", () => {
    const path = "/home/user/.claude/MEMORY/WORK/20260101-120000_slug-name/PRD.md";
    expect(extractSessionDir(path)).toBe("20260101-120000_slug-name");
  });
});

// ─── PRDSync session state sync ─────────────────────────────────────────────

describe("PRDSync session state sync", () => {
  const PRD_CONTENT = `---
task: Test task
slug: test-slug
effort: Standard
phase: observe
progress: 0/5
mode: algorithm
started: 2026-03-15T15:00:00+11:00
updated: 2026-03-15T15:00:00+11:00
---

## Criteria

- [ ] ISC-1: First criterion
- [ ] ISC-2: Second criterion
`;

  function mockReadJson(_path: string): Result<unknown, PaiError> {
    return ok({});
  }

  function makeDeps(overrides: Partial<PRDSyncDeps> = {}): PRDSyncDeps {
    return {
      readFile: () => ok(PRD_CONTENT),
      writeFile: () => ok(undefined),
      fileExists: () => true,
      readJson: mockReadJson as PRDSyncDeps["readJson"],
      stderr: () => {},
      baseDir: "/tmp/test",
      ...overrides,
    };
  }

  test("updates session state file with new session_dir when PRD is written", () => {
    const written: Record<string, string> = {};
    const existingState = {
      session_id: "test-session-123",
      session_dir: "old-dir-name",
      current_task: "001_old-task",
      task_title: "Old task",
      task_count: 1,
      created_at: "2026-03-15T00:00:00Z",
    };

    const deps = makeDeps({
      writeFile: (path: string, content: string) => {
        written[path] = content;
        return ok(undefined);
      },
      readJson: ((path: string) => {
        if (path.includes("current-work-")) return ok(existingState);
        return ok({});
      }) as PRDSyncDeps["readJson"],
    });

    const input = {
      session_id: "test-session-123",
      tool_name: "Write" as const,
      tool_input: {
        file_path: "/tmp/test/MEMORY/WORK/20260315-155100_new-task/PRD.md",
        content: PRD_CONTENT,
      },
    };

    PRDSync.execute(input, deps);

    const stateFilePath = "/tmp/test/MEMORY/STATE/current-work-test-session-123.json";
    expect(written[stateFilePath]).toBeDefined();
    const parsed = JSON.parse(written[stateFilePath]);
    expect(parsed.session_dir).toBe("20260315-155100_new-task");
    expect(parsed.session_id).toBe("test-session-123");
    expect(parsed.current_task).toBe("001_old-task");
  });

  test("preserves existing state file fields when updating session_dir", () => {
    const written: Record<string, string> = {};
    const existingState = {
      session_id: "sess-456",
      session_dir: "original-dir",
      current_task: "001_my-task",
      task_title: "My important task",
      task_count: 3,
      created_at: "2026-03-15T10:00:00Z",
      prd_path: "/old/path/PRD.md",
    };

    const deps = makeDeps({
      writeFile: (path: string, content: string) => {
        written[path] = content;
        return ok(undefined);
      },
      readJson: ((path: string) => {
        if (path.includes("current-work-")) return ok(existingState);
        return ok({});
      }) as PRDSyncDeps["readJson"],
    });

    const input = {
      session_id: "sess-456",
      tool_name: "Write" as const,
      tool_input: {
        file_path: "/tmp/test/MEMORY/WORK/20260315-120000_updated-task/PRD.md",
        content: PRD_CONTENT,
      },
    };

    PRDSync.execute(input, deps);

    const stateFilePath = "/tmp/test/MEMORY/STATE/current-work-sess-456.json";
    const parsed = JSON.parse(written[stateFilePath]);
    expect(parsed.session_dir).toBe("20260315-120000_updated-task");
    expect(parsed.task_title).toBe("My important task");
    expect(parsed.task_count).toBe(3);
    expect(parsed.created_at).toBe("2026-03-15T10:00:00Z");
  });

  test("skips session state sync when no state file exists", () => {
    const stderrMessages: string[] = [];
    const written: Record<string, string> = {};

    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("current-work-")) return false;
        return true;
      },
      writeFile: (path: string, content: string) => {
        written[path] = content;
        return ok(undefined);
      },
      stderr: (msg: string) => {
        stderrMessages.push(msg);
      },
    });

    const input = {
      session_id: "no-state-session",
      tool_name: "Write" as const,
      tool_input: {
        file_path: "/tmp/test/MEMORY/WORK/20260315-155100_task/PRD.md",
        content: PRD_CONTENT,
      },
    };

    const result = PRDSync.execute(input, deps);
    expect(result.ok).toBe(true);

    // Should NOT have written a state file
    const stateFilePath = "/tmp/test/MEMORY/STATE/current-work-no-state-session.json";
    expect(written[stateFilePath]).toBeUndefined();
  });

  test("logs session state sync result to stderr", () => {
    const stderrMessages: string[] = [];

    const deps = makeDeps({
      writeFile: () => ok(undefined),
      readJson: ((path: string) => {
        if (path.includes("current-work-")) {
          return ok({ session_id: "log-test", session_dir: "old" });
        }
        return ok({});
      }) as PRDSyncDeps["readJson"],
      stderr: (msg: string) => {
        stderrMessages.push(msg);
      },
    });

    const input = {
      session_id: "log-test",
      tool_name: "Write" as const,
      tool_input: {
        file_path: "/tmp/test/MEMORY/WORK/20260315-155100_task/PRD.md",
        content: PRD_CONTENT,
      },
    };

    PRDSync.execute(input, deps);

    const sessionSyncLog = stderrMessages.find((m) => m.includes("session state"));
    expect(sessionSyncLog).toBeDefined();
  });
});

// ─── Existing functionality ─────────────────────────────────────────────────

describe("parseFrontmatter", () => {
  test("parses valid frontmatter", () => {
    const content = `---
task: My task
slug: my-task
phase: observe
---

Body content`;
    const fm = parseFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(fm!.task).toBe("My task");
    expect(fm!.slug).toBe("my-task");
    expect(fm!.phase).toBe("observe");
  });

  test("returns null for no frontmatter", () => {
    expect(parseFrontmatter("Just some text")).toBeNull();
  });
});

describe("parseCriteriaCounts", () => {
  test("counts checked and unchecked criteria", () => {
    const content = `
- [x] ISC-1: Done
- [ ] ISC-2: Not done
- [x] ISC-3: Also done
`;
    const counts = parseCriteriaCounts(content);
    expect(counts.total).toBe(3);
    expect(counts.done).toBe(2);
  });
});

// ─── PRDSync.accepts ────────────────────────────────────────────────────────

describe("PRDSync.accepts", () => {
  test("accepts Write to a PRD.md in MEMORY/WORK/", () => {
    expect(PRDSync.accepts({
      session_id: "s", tool_name: "Write",
      tool_input: { file_path: "/tmp/.claude/MEMORY/WORK/slug/PRD.md", content: "" },
    })).toBe(true);
  });

  test("accepts Edit to a PRD.md in MEMORY/WORK/", () => {
    expect(PRDSync.accepts({
      session_id: "s", tool_name: "Edit",
      tool_input: { file_path: "/tmp/.claude/MEMORY/WORK/slug/PRD.md", old_string: "", new_string: "" },
    })).toBe(true);
  });

  test("rejects non-Write/Edit tools", () => {
    expect(PRDSync.accepts({
      session_id: "s", tool_name: "Read",
      tool_input: { file_path: "/tmp/.claude/MEMORY/WORK/slug/PRD.md" },
    })).toBe(false);
  });

  test("rejects files not in MEMORY/WORK/", () => {
    expect(PRDSync.accepts({
      session_id: "s", tool_name: "Write",
      tool_input: { file_path: "/tmp/other/PRD.md", content: "" },
    })).toBe(false);
  });
});

// ─── PRDSync.execute — error branches ───────────────────────────────────────

describe("PRDSync.execute — error branches", () => {
  const PRD_PATH = "/tmp/test/MEMORY/WORK/20260315-slug/PRD.md";

  function makeExecInput(filePath = PRD_PATH) {
    return {
      session_id: "test-sess",
      tool_name: "Write" as const,
      tool_input: { file_path: filePath, content: "ignored" },
    };
  }

  const VALID_PRD = `---
task: Test
slug: test-slug
phase: observe
progress: 0/2
mode: algorithm
started: 2026-01-01
updated: 2026-01-01
---

## Criteria

- [ ] ISC-1: First
`;

  function makeSyncDeps(overrides: Partial<PRDSyncDeps> = {}): PRDSyncDeps {
    return {
      readFile: () => ok(VALID_PRD),
      writeFile: () => ok(undefined),
      fileExists: () => true,
      readJson: (() => ok({})) as PRDSyncDeps["readJson"],
      stderr: () => {},
      baseDir: "/tmp/test",
      ...overrides,
    };
  }

  test("continues when PRD file not found on disk", () => {
    const stderrMsgs: string[] = [];
    const deps = makeSyncDeps({
      fileExists: () => false,
      stderr: (m) => stderrMsgs.push(m),
    });
    const result = PRDSync.execute(makeExecInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
    expect(stderrMsgs.some((m) => m.includes("not found on disk"))).toBe(true);
  });

  test("continues when readFile fails", () => {
    const stderrMsgs: string[] = [];
    const deps = makeSyncDeps({
      readFile: () => err(fileReadFailed("/prd", new Error("io err"))),
      stderr: (m) => stderrMsgs.push(m),
    });
    const result = PRDSync.execute(makeExecInput(), deps);
    expect(result.ok).toBe(true);
    expect(stderrMsgs.some((m) => m.includes("Failed to read PRD"))).toBe(true);
  });

  test("continues when frontmatter is missing", () => {
    const stderrMsgs: string[] = [];
    const deps = makeSyncDeps({
      readFile: () => ok("Just plain text, no frontmatter"),
      stderr: (m) => stderrMsgs.push(m),
    });
    const result = PRDSync.execute(makeExecInput(), deps);
    expect(result.ok).toBe(true);
    expect(stderrMsgs.some((m) => m.includes("No frontmatter"))).toBe(true);
  });

  test("continues when slug is missing from frontmatter", () => {
    const stderrMsgs: string[] = [];
    const noSlugPrd = `---
task: Test
phase: observe
---
`;
    const deps = makeSyncDeps({
      readFile: () => ok(noSlugPrd),
      stderr: (m) => stderrMsgs.push(m),
    });
    const result = PRDSync.execute(makeExecInput(), deps);
    expect(result.ok).toBe(true);
    expect(stderrMsgs.some((m) => m.includes("missing slug"))).toBe(true);
  });

  test("handles session state readJson failure gracefully", () => {
    const stderrMsgs: string[] = [];
    const deps = makeSyncDeps({
      readJson: ((path: string) => {
        if (path.includes("current-work-")) return err(fileReadFailed(path, new Error("corrupt")));
        return ok({});
      }) as PRDSyncDeps["readJson"],
      stderr: (m) => stderrMsgs.push(m),
    });
    const result = PRDSync.execute(makeExecInput(), deps);
    expect(result.ok).toBe(true);
    expect(stderrMsgs.some((m) => m.includes("Failed to read session state"))).toBe(true);
  });

  test("handles session state writeFile failure gracefully", () => {
    const stderrMsgs: string[] = [];
    const deps = makeSyncDeps({
      readJson: (() => ok({ session_id: "s" })) as PRDSyncDeps["readJson"],
      writeFile: (path: string) => {
        // Fail on session state write, succeed on work.json
        if (path.includes("current-work-")) return err(fileReadFailed(path, new Error("disk full")));
        return ok(undefined);
      },
      stderr: (m) => stderrMsgs.push(m),
    });
    const result = PRDSync.execute(makeExecInput(), deps);
    expect(result.ok).toBe(true);
    expect(stderrMsgs.some((m) => m.includes("Failed to write session state"))).toBe(true);
  });

  test("handles work.json readJson failure (starts fresh)", () => {
    const stderrMsgs: string[] = [];
    const deps = makeSyncDeps({
      readJson: ((path: string) => {
        if (path.includes("work.json")) return err(fileReadFailed(path, new Error("corrupt")));
        return ok({});
      }) as PRDSyncDeps["readJson"],
      stderr: (m) => stderrMsgs.push(m),
    });
    const result = PRDSync.execute(makeExecInput(), deps);
    expect(result.ok).toBe(true);
    expect(stderrMsgs.some((m) => m.includes("starting fresh"))).toBe(true);
  });
});
