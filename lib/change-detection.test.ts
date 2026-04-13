/**
 * Tests for lib/change-detection.ts — PAI system change detection utilities.
 *
 * Uses makeChangeDetectionDeps() factory with in-memory filesystem state.
 * No real I/O — all filesystem calls are intercepted by fake deps.
 */

import { describe, expect, it } from "bun:test";
import type { ResultError } from "@hooks/core/error";
import { jsonParseFailed } from "@hooks/core/error";
import { err, ok, tryCatch } from "@hooks/core/result";
import type { ChangeDetectionDeps, FileChange, IntegrityState } from "@hooks/lib/change-detection";
import {
  categorizeChange,
  determineSignificance,
  generateDescriptiveTitle,
  getCooldownEndTime,
  hashChanges,
  inferChangeType,
  isDuplicateRun,
  isInCooldown,
  isSignificantChange,
  parseToolUseBlocks,
  shouldDocumentChanges,
} from "@hooks/lib/change-detection";

// ─── Fake deps factory ────────────────────────────────────────────────────────

interface FakeFS {
  files: Map<string, string>;
}

function makeChangeDetectionDeps(fs: FakeFS, paiDir = "/fake/pai"): ChangeDetectionDeps {
  return {
    paiDir,
    fileExists: (path: string) => fs.files.has(path),
    readFile: (path: string) => {
      const content = fs.files.get(path);
      if (content === undefined)
        return err({ code: "FILE_NOT_FOUND", message: "not found" } as ResultError);
      return ok(content);
    },
    readJson: <T>(path: string) => {
      const content = fs.files.get(path);
      if (content === undefined)
        return err<T, ResultError>({ code: "FILE_NOT_FOUND", message: "not found" } as ResultError);
      const parsed = tryCatch(
        () => JSON.parse(content) as unknown,
        (e) => jsonParseFailed(content.slice(0, 80), e),
      );
      if (!parsed.ok) return err<T, ResultError>(parsed.error);
      return ok<T, ResultError>(parsed.value as T);
    },
    writeFile: (path: string, content: string) => {
      fs.files.set(path, content);
      return ok(undefined);
    },
    parseJsonLine: <T>(raw: string) =>
      tryCatch(
        () => JSON.parse(raw) as T,
        (e) => jsonParseFailed(raw.slice(0, 80), e),
      ),
  };
}

function makeChange(overrides: Partial<FileChange> = {}): FileChange {
  return {
    tool: "Edit",
    path: "skills/MySkill/SKILL.md",
    category: "skill",
    isPhilosophical: false,
    isStructural: false,
    ...overrides,
  };
}

// ─── parseToolUseBlocks ───────────────────────────────────────────────────────

describe("parseToolUseBlocks", () => {
  it("returns empty array when transcript file does not exist", () => {
    const deps = makeChangeDetectionDeps({ files: new Map() });
    const result = parseToolUseBlocks("/nonexistent/transcript.jsonl", deps);
    expect(result).toEqual([]);
  });

  it("returns empty array when transcript is empty", () => {
    const fs: FakeFS = { files: new Map([["/transcript.jsonl", ""]]) };
    const deps = makeChangeDetectionDeps(fs);
    const result = parseToolUseBlocks("/transcript.jsonl", deps);
    expect(result).toEqual([]);
  });

  it("extracts Write tool_use blocks from transcript", () => {
    const entry = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Write",
            input: { file_path: "/fake/pai/skills/MySkill/SKILL.md" },
          },
        ],
      },
    });
    const fs: FakeFS = { files: new Map([["/transcript.jsonl", entry]]) };
    const deps = makeChangeDetectionDeps(fs, "/fake/pai");
    const result = parseToolUseBlocks("/transcript.jsonl", deps);
    expect(result).toHaveLength(1);
    expect(result[0].tool).toBe("Write");
  });

  it("extracts Edit tool_use blocks from transcript", () => {
    const entry = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { file_path: "/fake/pai/skills/MySkill/file.ts" },
          },
        ],
      },
    });
    const fs: FakeFS = { files: new Map([["/transcript.jsonl", entry]]) };
    const deps = makeChangeDetectionDeps(fs, "/fake/pai");
    const result = parseToolUseBlocks("/transcript.jsonl", deps);
    expect(result).toHaveLength(1);
    expect(result[0].tool).toBe("Edit");
  });

  it("extracts MultiEdit blocks (each edit becomes a separate FileChange)", () => {
    const entry = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "MultiEdit",
            input: {
              edits: [
                { file_path: "/fake/pai/skills/A/file.ts" },
                { file_path: "/fake/pai/skills/B/file.ts" },
              ],
            },
          },
        ],
      },
    });
    const fs: FakeFS = { files: new Map([["/transcript.jsonl", entry]]) };
    const deps = makeChangeDetectionDeps(fs, "/fake/pai");
    const result = parseToolUseBlocks("/transcript.jsonl", deps);
    expect(result).toHaveLength(2);
  });

  it("deduplicates repeated paths in the same transcript", () => {
    const makeEditEntry = (path: string) =>
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Edit", input: { file_path: path } }],
        },
      });
    const path = "/fake/pai/skills/X/file.ts";
    const content = [makeEditEntry(path), makeEditEntry(path)].join("\n");
    const fs: FakeFS = { files: new Map([["/transcript.jsonl", content]]) };
    const deps = makeChangeDetectionDeps(fs, "/fake/pai");
    const result = parseToolUseBlocks("/transcript.jsonl", deps);
    expect(result).toHaveLength(1);
  });

  it("ignores non-assistant message types", () => {
    const entry = JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_use", name: "Write", input: { file_path: "/fake/pai/x.ts" } }],
      },
    });
    const fs: FakeFS = { files: new Map([["/transcript.jsonl", entry]]) };
    const deps = makeChangeDetectionDeps(fs, "/fake/pai");
    const result = parseToolUseBlocks("/transcript.jsonl", deps);
    expect(result).toEqual([]);
  });

  it("skips malformed JSON lines without throwing", () => {
    const content = "not json\n" + JSON.stringify({ type: "assistant", message: { content: [] } });
    const fs: FakeFS = { files: new Map([["/transcript.jsonl", content]]) };
    const deps = makeChangeDetectionDeps(fs);
    expect(() => parseToolUseBlocks("/transcript.jsonl", deps)).not.toThrow();
  });
});

// ─── categorizeChange ─────────────────────────────────────────────────────────

describe("categorizeChange", () => {
  it("returns null for MEMORY/WORK/ paths (excluded)", () => {
    expect(categorizeChange("MEMORY/WORK/something.md", "/fake/pai")).toBeNull();
  });

  it("returns null for MEMORY/STATE/ paths (excluded)", () => {
    expect(categorizeChange("MEMORY/STATE/algo.json", "/fake/pai")).toBeNull();
  });

  it("returns null for .git/ paths", () => {
    expect(categorizeChange(".git/COMMIT_EDITMSG", "/fake/pai")).toBeNull();
  });

  it("returns null for paths outside paiDir", () => {
    expect(categorizeChange("/other/dir/file.ts", "/fake/pai")).toBeNull();
  });

  it("categorizes skills/ paths as skill", () => {
    expect(categorizeChange("skills/MySkill/file.ts", "/fake/pai")).toBe("skill");
  });

  it("categorizes skills/ with Workflows/ as workflow", () => {
    expect(categorizeChange("skills/MySkill/Workflows/routing.md", "/fake/pai")).toBe("workflow");
  });

  it("categorizes hooks/ paths as hook", () => {
    expect(categorizeChange("hooks/MyHook/contract.ts", "/fake/pai")).toBe("hook");
  });

  it("categorizes MEMORY/PAISYSTEMUPDATES/ as documentation", () => {
    expect(categorizeChange("MEMORY/PAISYSTEMUPDATES/entry.md", "/fake/pai")).toBe("documentation");
  });

  it("categorizes settings.json as config", () => {
    expect(categorizeChange("settings.json", "/fake/pai")).toBe("config");
  });

  it("categorizes .md files (outside WORK/) as documentation", () => {
    expect(categorizeChange("some/file.md", "/fake/pai")).toBe("documentation");
  });

  it("returns null for private skills (prefixed with _)", () => {
    expect(categorizeChange("skills/_PrivateSkill/file.ts", "/fake/pai")).toBeNull();
  });
});

// ─── isSignificantChange ──────────────────────────────────────────────────────

describe("isSignificantChange", () => {
  it("returns false when no system changes (all null category)", () => {
    const changes = [makeChange({ category: null })];
    expect(isSignificantChange(changes)).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(isSignificantChange([])).toBe(false);
  });

  it("returns true for philosophical changes", () => {
    const changes = [makeChange({ category: "skill", isPhilosophical: true })];
    expect(isSignificantChange(changes)).toBe(true);
  });

  it("returns true for structural changes", () => {
    const changes = [makeChange({ category: "skill", isStructural: true })];
    expect(isSignificantChange(changes)).toBe(true);
  });

  it("returns true for 2+ system files changed", () => {
    const changes = [
      makeChange({ category: "skill" }),
      makeChange({ category: "hook", path: "hooks/X/file.ts" }),
    ];
    expect(isSignificantChange(changes)).toBe(true);
  });

  it("returns true for skill category", () => {
    const changes = [makeChange({ category: "skill" })];
    expect(isSignificantChange(changes)).toBe(true);
  });

  it("returns true for hook category", () => {
    const changes = [makeChange({ category: "hook", path: "hooks/X/file.ts" })];
    expect(isSignificantChange(changes)).toBe(true);
  });

  it("returns true for core-system category", () => {
    const changes = [makeChange({ category: "core-system", path: "PAI/core.md" })];
    expect(isSignificantChange(changes)).toBe(true);
  });

  it("returns true for workflow category", () => {
    const changes = [makeChange({ category: "workflow", path: "skills/X/Workflows/r.md" })];
    expect(isSignificantChange(changes)).toBe(true);
  });
});

// ─── shouldDocumentChanges ────────────────────────────────────────────────────

describe("shouldDocumentChanges", () => {
  it("returns false for empty changes", () => {
    expect(shouldDocumentChanges([])).toBe(false);
  });

  it("returns false when all categories are null", () => {
    expect(shouldDocumentChanges([makeChange({ category: null })])).toBe(false);
  });

  it("returns true for philosophical changes", () => {
    expect(
      shouldDocumentChanges([makeChange({ category: "skill", isPhilosophical: true })]),
    ).toBe(true);
  });

  it("returns true for skill changes", () => {
    expect(shouldDocumentChanges([makeChange({ category: "skill" })])).toBe(true);
  });

  it("returns true for hook changes", () => {
    expect(
      shouldDocumentChanges([makeChange({ category: "hook", path: "hooks/X/f.ts" })]),
    ).toBe(true);
  });

  it("returns true for config changes", () => {
    expect(
      shouldDocumentChanges([makeChange({ category: "config", path: "settings.json" })]),
    ).toBe(true);
  });

  it("returns true when 2+ system files changed", () => {
    const changes = [
      makeChange({ category: "documentation", path: "file1.md" }),
      makeChange({ category: "documentation", path: "file2.md" }),
    ];
    expect(shouldDocumentChanges(changes)).toBe(true);
  });

  it("returns true for new file creation (Write tool)", () => {
    expect(
      shouldDocumentChanges([makeChange({ tool: "Write", category: "documentation" })]),
    ).toBe(true);
  });
});

// ─── hashChanges ─────────────────────────────────────────────────────────────

describe("hashChanges", () => {
  it("returns a string", () => {
    const result = hashChanges([makeChange()]);
    expect(typeof result).toBe("string");
  });

  it("returns the same hash for identical change sets", () => {
    const changes = [makeChange({ tool: "Edit", path: "skills/X/file.ts" })];
    expect(hashChanges(changes)).toBe(hashChanges(changes));
  });

  it("returns different hashes for different paths", () => {
    const a = [makeChange({ path: "skills/A/file.ts" })];
    const b = [makeChange({ path: "skills/B/file.ts" })];
    expect(hashChanges(a)).not.toBe(hashChanges(b));
  });

  it("is order-independent (sorts before hashing)", () => {
    const c1 = makeChange({ path: "skills/A/file.ts" });
    const c2 = makeChange({ path: "skills/B/file.ts" });
    expect(hashChanges([c1, c2])).toBe(hashChanges([c2, c1]));
  });

  it("returns a hex string for empty array", () => {
    const result = hashChanges([]);
    expect(result).toMatch(/^-?[0-9a-f]+$/);
  });
});

// ─── isDuplicateRun ───────────────────────────────────────────────────────────

describe("isDuplicateRun", () => {
  it("returns false when no integrity state file exists", () => {
    const deps = makeChangeDetectionDeps({ files: new Map() });
    expect(isDuplicateRun([makeChange()], deps)).toBe(false);
  });

  it("returns false when integrity state has no hash", () => {
    const stateFile = "/fake/pai/MEMORY/STATE/integrity-state.json";
    const state: IntegrityState = {
      last_run: new Date().toISOString(),
      last_changes_hash: "",
      cooldown_until: null,
    };
    const fs: FakeFS = { files: new Map([[stateFile, JSON.stringify(state)]]) };
    const deps = makeChangeDetectionDeps(fs);
    expect(isDuplicateRun([makeChange()], deps)).toBe(false);
  });

  it("returns true when hash matches the stored hash", () => {
    const changes = [makeChange({ path: "skills/X/SKILL.md" })];
    const currentHash = hashChanges(changes);
    const stateFile = "/fake/pai/MEMORY/STATE/integrity-state.json";
    const state: IntegrityState = {
      last_run: new Date().toISOString(),
      last_changes_hash: currentHash,
      cooldown_until: null,
    };
    const fs: FakeFS = { files: new Map([[stateFile, JSON.stringify(state)]]) };
    const deps = makeChangeDetectionDeps(fs);
    expect(isDuplicateRun(changes, deps)).toBe(true);
  });

  it("returns false when hash does not match", () => {
    const changes = [makeChange({ path: "skills/X/SKILL.md" })];
    const stateFile = "/fake/pai/MEMORY/STATE/integrity-state.json";
    const state: IntegrityState = {
      last_run: new Date().toISOString(),
      last_changes_hash: "deadbeef",
      cooldown_until: null,
    };
    const fs: FakeFS = { files: new Map([[stateFile, JSON.stringify(state)]]) };
    const deps = makeChangeDetectionDeps(fs);
    expect(isDuplicateRun(changes, deps)).toBe(false);
  });
});

// ─── isInCooldown ─────────────────────────────────────────────────────────────

describe("isInCooldown", () => {
  it("returns false when no integrity state exists", () => {
    const deps = makeChangeDetectionDeps({ files: new Map() });
    expect(isInCooldown(deps)).toBe(false);
  });

  it("returns false when cooldown_until is null", () => {
    const stateFile = "/fake/pai/MEMORY/STATE/integrity-state.json";
    const state: IntegrityState = {
      last_run: new Date().toISOString(),
      last_changes_hash: "abc",
      cooldown_until: null,
    };
    const fs: FakeFS = { files: new Map([[stateFile, JSON.stringify(state)]]) };
    const deps = makeChangeDetectionDeps(fs);
    expect(isInCooldown(deps)).toBe(false);
  });

  it("returns true when cooldown_until is in the future", () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const stateFile = "/fake/pai/MEMORY/STATE/integrity-state.json";
    const state: IntegrityState = {
      last_run: new Date().toISOString(),
      last_changes_hash: "abc",
      cooldown_until: future,
    };
    const fs: FakeFS = { files: new Map([[stateFile, JSON.stringify(state)]]) };
    const deps = makeChangeDetectionDeps(fs);
    expect(isInCooldown(deps)).toBe(true);
  });

  it("returns false when cooldown_until is in the past", () => {
    const past = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const stateFile = "/fake/pai/MEMORY/STATE/integrity-state.json";
    const state: IntegrityState = {
      last_run: new Date().toISOString(),
      last_changes_hash: "abc",
      cooldown_until: past,
    };
    const fs: FakeFS = { files: new Map([[stateFile, JSON.stringify(state)]]) };
    const deps = makeChangeDetectionDeps(fs);
    expect(isInCooldown(deps)).toBe(false);
  });
});

// ─── determineSignificance ────────────────────────────────────────────────────

describe("determineSignificance", () => {
  it("returns 'minor' for a single non-structural non-philosophical change", () => {
    const changes = [makeChange({ category: "skill", isStructural: false, isPhilosophical: false })];
    expect(determineSignificance(changes)).toBe("minor");
  });

  it("returns 'major' when core-system category is present", () => {
    const changes = [makeChange({ category: "core-system", path: "PAI/core.md" })];
    expect(determineSignificance(changes)).toBe("major");
  });

  it("returns 'moderate' for 3+ changes", () => {
    const changes = [
      makeChange({ path: "a.md" }),
      makeChange({ path: "b.md" }),
      makeChange({ path: "c.md" }),
    ];
    expect(determineSignificance(changes)).toBe("moderate");
  });

  it("returns 'major' for new files with structural changes", () => {
    const changes = [makeChange({ tool: "Write", isStructural: true })];
    expect(determineSignificance(changes)).toBe("major");
  });

  it("returns 'critical' for structural + philosophical + 5+ changes", () => {
    const changes = Array.from({ length: 5 }, (_, i) =>
      makeChange({ path: `file${i}.md`, isStructural: true, isPhilosophical: true }),
    );
    expect(determineSignificance(changes)).toBe("critical");
  });

  it("returns 'major' for 3+ hook changes", () => {
    const changes = [
      makeChange({ category: "hook", path: "hooks/A/f.ts" }),
      makeChange({ category: "hook", path: "hooks/B/f.ts" }),
      makeChange({ category: "hook", path: "hooks/C/f.ts" }),
    ];
    expect(determineSignificance(changes)).toBe("major");
  });
});

// ─── inferChangeType ──────────────────────────────────────────────────────────

describe("inferChangeType", () => {
  it("returns 'skill_update' for a single non-structural skill change", () => {
    const changes = [makeChange({ category: "skill", isStructural: false })];
    expect(inferChangeType(changes)).toBe("skill_update");
  });

  it("returns 'structure_change' for a structural skill change", () => {
    const changes = [makeChange({ category: "skill", isStructural: true })];
    expect(inferChangeType(changes)).toBe("structure_change");
  });

  it("returns 'hook_update' for hook changes", () => {
    const changes = [makeChange({ category: "hook", path: "hooks/X/f.ts" })];
    expect(inferChangeType(changes)).toBe("hook_update");
  });

  it("returns 'workflow_update' for workflow changes", () => {
    const changes = [makeChange({ category: "workflow", path: "skills/X/Workflows/r.md" })];
    expect(inferChangeType(changes)).toBe("workflow_update");
  });

  it("returns 'config_update' for config changes", () => {
    const changes = [makeChange({ category: "config", path: "settings.json" })];
    expect(inferChangeType(changes)).toBe("config_update");
  });

  it("returns 'doc_update' for documentation changes", () => {
    const changes = [makeChange({ category: "documentation", path: "some.md" })];
    expect(inferChangeType(changes)).toBe("doc_update");
  });

  it("returns 'structure_change' for core-system changes", () => {
    const changes = [makeChange({ category: "core-system", path: "PAI/core.md" })];
    expect(inferChangeType(changes)).toBe("structure_change");
  });

  it("returns 'multi_area' for 3+ distinct categories", () => {
    const changes = [
      makeChange({ category: "skill" }),
      makeChange({ category: "hook", path: "hooks/X/f.ts" }),
      makeChange({ category: "config", path: "settings.json" }),
    ];
    expect(inferChangeType(changes)).toBe("multi_area");
  });

  it("prefers hook_update when two categories present and one is hook", () => {
    const changes = [
      makeChange({ category: "hook", path: "hooks/X/f.ts" }),
      makeChange({ category: "documentation", path: "doc.md" }),
    ];
    expect(inferChangeType(changes)).toBe("hook_update");
  });
});

// ─── getCooldownEndTime ───────────────────────────────────────────────────────

describe("getCooldownEndTime", () => {
  it("returns an ISO 8601 timestamp string", () => {
    const result = getCooldownEndTime();
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("returns a timestamp approximately 2 minutes in the future", () => {
    const before = Date.now();
    const result = getCooldownEndTime();
    const after = Date.now();

    const resultMs = new Date(result).getTime();
    // Must be at least 1 min 59 sec ahead of before
    expect(resultMs).toBeGreaterThanOrEqual(before + 119 * 1000);
    // Must be at most 2 min 1 sec ahead of after (clock drift tolerance)
    expect(resultMs).toBeLessThanOrEqual(after + 121 * 1000);
  });

  it("returns a value that is in the future relative to now", () => {
    const result = getCooldownEndTime();
    expect(new Date(result).getTime()).toBeGreaterThan(Date.now());
  });
});

// ─── generateDescriptiveTitle ─────────────────────────────────────────────────

describe("generateDescriptiveTitle", () => {
  it("generates a title for a single skill update", () => {
    const changes = [makeChange({ path: "skills/Research/SKILL.md", category: "skill" })];
    const title = generateDescriptiveTitle(changes);
    expect(title).toContain("Research");
    expect(title.split(/\s+/).length).toBeGreaterThanOrEqual(4);
  });

  it("generates a title for hook changes", () => {
    const changes = [makeChange({ path: "hooks/MyHook/contract.ts", category: "hook" })];
    const title = generateDescriptiveTitle(changes);
    expect(title.toLowerCase()).toContain("hook");
  });

  it("generates a title for config changes", () => {
    const changes = [makeChange({ path: "settings.json", category: "config" })];
    const title = generateDescriptiveTitle(changes);
    expect(title).toContain("Configuration");
  });

  it("generates a title for multiple skills", () => {
    const changes = [
      makeChange({ path: "skills/Alpha/file.ts", category: "skill" }),
      makeChange({ path: "skills/Beta/file.ts", category: "skill" }),
    ];
    const title = generateDescriptiveTitle(changes);
    expect(title).toContain("Alpha");
    expect(title).toContain("Beta");
  });

  it("produces a title with 4-8 words", () => {
    const changes = [makeChange({ path: "skills/Research/SKILL.md", category: "skill" })];
    const title = generateDescriptiveTitle(changes);
    const wordCount = title.split(/\s+/).length;
    expect(wordCount).toBeGreaterThanOrEqual(4);
    expect(wordCount).toBeLessThanOrEqual(8);
  });

  it("falls back gracefully for unrecognized paths", () => {
    const changes = [makeChange({ path: "some/unknown/path.ts", category: "documentation" })];
    const title = generateDescriptiveTitle(changes);
    expect(typeof title).toBe("string");
    expect(title.length).toBeGreaterThan(0);
  });
});
