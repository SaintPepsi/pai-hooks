import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  ensureDir,
  fileExists,
  readDir,
  readFile,
  removeDir,
  setFileTimes,
  stat,
  writeFile,
} from "@hooks/core/adapters/fs";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok, type Result } from "@hooks/core/result";
import type { LoadContextDeps } from "./LoadContext.contract";
import { loadPendingProposals } from "./LoadContext.contract";

const TEST_DIR = join(import.meta.dir, "__test-load-context-proposals__");

// ─── Section 1: Format & regex tests (pass immediately) ─────────────────────

describe("Proposal format parsing", () => {
  beforeEach(() => {
    ensureDir(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending"));
  });

  afterEach(() => {
    removeDir(TEST_DIR);
  });

  it("directory structure is created correctly", () => {
    expect(fileExists(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending"))).toBe(true);
  });

  it("proposal title regex extracts correctly", () => {
    const content = `---\ncategory: steering-rule\n---\n\n# Proposal: Add retry limit to agent loops\n`;
    const titleMatch = content.match(/^# Proposal: (.+)$/m);
    expect(titleMatch).not.toBeNull();
    expect(titleMatch![1]).toBe("Add retry limit to agent loops");
  });

  it("frontmatter-scoped category regex extracts correctly", () => {
    const content = `---\nid: PROP-1\ncategory: steering-rule\n---\n\n# Proposal: Test\n\ncategory: this-should-not-match\n`;
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
    const categoryMatch = frontmatter?.[1]?.match(/^category:\s*(.+)$/m);
    expect(categoryMatch).not.toBeNull();
    expect(categoryMatch![1]).toBe("steering-rule");
  });

  it("handles proposal without category gracefully", () => {
    const content = `---\nid: PROP-2\nstatus: pending\n---\n\n# Proposal: Fix something\n`;
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
    const categoryMatch = frontmatter?.[1]?.match(/^category:\s*(.+)$/m);
    expect(categoryMatch).toBeNull();
    // loadPendingProposals falls back to "general"
  });

  it("can create 8 proposals and count them correctly", () => {
    for (let i = 0; i < 8; i++) {
      writeFile(
        join(TEST_DIR, `MEMORY/LEARNING/PROPOSALS/pending/20260227-17000${i}-proposal-${i}.md`),
        `---\ncategory: memory\n---\n\n# Proposal: Proposal number ${i}\n`,
      );
    }
    const filesResult = readDir(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending"));
    const files = filesResult.ok
      ? filesResult.value.filter((f: string) => f.endsWith(".md") && f !== ".gitkeep")
      : [];
    expect(files.length).toBe(8);
  });
});

// ─── Section 2: Integration tests ────────────────────────────────────────────

const INT_TEST_DIR = join(import.meta.dir, "__test-lc-proposals-integration__");

type ProposalDeps = Pick<LoadContextDeps, "fileExists" | "readFile" | "readDir" | "stat">;

function makeProposalDeps(overrides: Partial<ProposalDeps> = {}): ProposalDeps {
  return {
    fileExists: (path: string) => fileExists(path),
    readFile: (path: string): Result<string, ResultError> => readFile(path),
    readDir: (
      path: string,
      opts?: { withFileTypes: true },
    ): Result<{ name: string; isDirectory(): boolean }[], ResultError> => {
      if (opts?.withFileTypes) {
        return readDir(path, { withFileTypes: true }) as Result<
          { name: string; isDirectory(): boolean }[],
          ResultError
        >;
      }
      return err(new ResultError(ErrorCode.FileReadFailed, "withFileTypes required"));
    },
    stat: (path: string): Result<{ mtimeMs: number }, ResultError> => {
      const s = stat(path);
      if (!s.ok) return s;
      return ok({ mtimeMs: s.value.mtimeMs });
    },
    ...overrides,
  };
}

describe("LoadContext proposals integration", () => {
  beforeEach(() => {
    ensureDir(join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending"));
  });

  afterEach(() => {
    removeDir(INT_TEST_DIR);
  });

  it("returns string with 'Pending Improvement Proposals' when proposals exist", () => {
    writeFile(
      join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending/20260227-120000-test-proposal.md"),
      "---\ncategory: steering-rule\npriority: medium\n---\n\n# Proposal: Add retry limit to agent loops\n\n## What was learned\nAgents retry indefinitely.\n",
    );

    const deps = makeProposalDeps();
    const result = loadPendingProposals(INT_TEST_DIR, deps);

    expect(result).not.toBeNull();
    expect(result).toContain("Pending Improvement Proposals");
    expect(result).toContain("Add retry limit to agent loops");
    expect(result).toContain("steering-rule");
  });

  it("returns null when .analyzing lock file is fresh", () => {
    writeFile(
      join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending/20260227-120000-test.md"),
      "---\ncategory: memory\n---\n\n# Proposal: Test\n",
    );
    writeFile(
      join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/.analyzing"),
      new Date().toISOString(),
    );

    const deps = makeProposalDeps();
    const result = loadPendingProposals(INT_TEST_DIR, deps);

    expect(result).toBeNull();
  });

  it("returns proposals when .analyzing lock file is stale (>10min)", () => {
    writeFile(
      join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending/20260227-120000-test.md"),
      "---\ncategory: memory\n---\n\n# Proposal: Stale lock test\n",
    );
    const staleTime = new Date(Date.now() - 11 * 60 * 1000);
    writeFile(
      join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/.analyzing"),
      staleTime.toISOString(),
    );
    // Backdate the lock file mtime
    const lockPath = join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/.analyzing");
    setFileTimes(lockPath, staleTime, staleTime);

    const deps = makeProposalDeps();
    const result = loadPendingProposals(INT_TEST_DIR, deps);

    expect(result).not.toBeNull();
    expect(result).toContain("Stale lock test");
  });

  it("shows max 5 proposals with overflow count when more exist", () => {
    for (let i = 0; i < 7; i++) {
      writeFile(
        join(INT_TEST_DIR, `MEMORY/LEARNING/PROPOSALS/pending/20260227-12000${i}-proposal-${i}.md`),
        `---\ncategory: hook\n---\n\n# Proposal: Improvement number ${i}\n`,
      );
    }

    const deps = makeProposalDeps();
    const result = loadPendingProposals(INT_TEST_DIR, deps);

    expect(result).not.toBeNull();
    expect(result).toContain("**7**");
    expect(result).toContain("...and 2 more");
  });
});
