import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "__test-load-context-proposals__");

// ─── Section 1: Format & regex tests (pass immediately) ─────────────────────

describe("Proposal format parsing", () => {
  beforeEach(() => {
    mkdirSync(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending"), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("directory structure is created correctly", () => {
    expect(existsSync(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending"))).toBe(true);
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
      writeFileSync(
        join(TEST_DIR, `MEMORY/LEARNING/PROPOSALS/pending/20260227-17000${i}-proposal-${i}.md`),
        `---\ncategory: memory\n---\n\n# Proposal: Proposal number ${i}\n`
      );
    }
    const files = readdirSync(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending"))
      .filter((f: string) => f.endsWith(".md") && f !== ".gitkeep");
    expect(files.length).toBe(8);
  });
});

// ─── Section 2: Integration tests (red until Task 3 modifies LoadContext) ────

import { loadPendingProposals } from "./LoadContext";
import type { LoadContextDeps } from "./LoadContext";
import { ok } from "../core/result";

const INT_TEST_DIR = join(import.meta.dir, "__test-lc-proposals-integration__");

function makeProposalDeps(overrides: Partial<LoadContextDeps> = {}): Pick<LoadContextDeps, "fileExists" | "readFile" | "readDir" | "stat" | "getDAName"> {
  return {
    fileExists: (path: string) => existsSync(path),
    readFile: (path: string) => {
      try { return ok(require("fs").readFileSync(path, "utf-8")); }
      catch { return { ok: false, error: { code: "READ_FAILED", message: "not found", context: {} } } as any; }
    },
    readDir: (path: string, opts?: any) => {
      try {
        const entries = readdirSync(path, opts);
        return ok(entries);
      } catch { return { ok: false, error: { code: "READ_DIR_FAILED", message: "not found", context: {} } } as any; }
    },
    stat: (path: string) => {
      try {
        const s = require("fs").statSync(path);
        return ok({ mtimeMs: s.mtimeMs });
      } catch { return { ok: false, error: { code: "STAT_FAILED", message: "not found", context: {} } } as any; }
    },
    getDAName: () => "Maple",
    ...overrides,
  };
}

describe("LoadContext proposals integration", () => {
  beforeEach(() => {
    mkdirSync(join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending"), { recursive: true });
  });

  afterEach(() => {
    rmSync(INT_TEST_DIR, { recursive: true, force: true });
  });

  it("returns string with 'Pending Improvement Proposals' when proposals exist", () => {
    writeFileSync(
      join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending/20260227-120000-test-proposal.md"),
      "---\ncategory: steering-rule\npriority: medium\n---\n\n# Proposal: Add retry limit to agent loops\n\n## What was learned\nAgents retry indefinitely.\n"
    );

    const deps = makeProposalDeps();
    const result = loadPendingProposals(INT_TEST_DIR, deps as any);

    expect(result).not.toBeNull();
    expect(result).toContain("Pending Improvement Proposals");
    expect(result).toContain("Add retry limit to agent loops");
    expect(result).toContain("steering-rule");
  });

  it("returns null when .analyzing lock file is fresh", () => {
    writeFileSync(
      join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending/20260227-120000-test.md"),
      "---\ncategory: memory\n---\n\n# Proposal: Test\n"
    );
    writeFileSync(
      join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/.analyzing"),
      new Date().toISOString()
    );

    const deps = makeProposalDeps();
    const result = loadPendingProposals(INT_TEST_DIR, deps as any);

    expect(result).toBeNull();
  });

  it("returns proposals when .analyzing lock file is stale (>10min)", () => {
    writeFileSync(
      join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending/20260227-120000-test.md"),
      "---\ncategory: memory\n---\n\n# Proposal: Stale lock test\n"
    );
    writeFileSync(
      join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/.analyzing"),
      new Date(Date.now() - 11 * 60 * 1000).toISOString()
    );
    // Backdate the lock file mtime
    const lockPath = join(INT_TEST_DIR, "MEMORY/LEARNING/PROPOSALS/.analyzing");
    require("fs").utimesSync(lockPath, new Date(Date.now() - 11 * 60 * 1000), new Date(Date.now() - 11 * 60 * 1000));

    const deps = makeProposalDeps();
    const result = loadPendingProposals(INT_TEST_DIR, deps as any);

    expect(result).not.toBeNull();
    expect(result).toContain("Stale lock test");
  });

  it("shows max 5 proposals with overflow count when more exist", () => {
    for (let i = 0; i < 7; i++) {
      writeFileSync(
        join(INT_TEST_DIR, `MEMORY/LEARNING/PROPOSALS/pending/20260227-12000${i}-proposal-${i}.md`),
        `---\ncategory: hook\n---\n\n# Proposal: Improvement number ${i}\n`
      );
    }

    const deps = makeProposalDeps();
    const result = loadPendingProposals(INT_TEST_DIR, deps as any);

    expect(result).not.toBeNull();
    expect(result).toContain("**7**");
    expect(result).toContain("...and 2 more");
  });
});
