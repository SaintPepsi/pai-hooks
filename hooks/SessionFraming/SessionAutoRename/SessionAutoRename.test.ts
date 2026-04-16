import { describe, expect, it, mock } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { UserPromptSubmitInput } from "@hooks/core/types/hook-inputs";

/** Wrap a state value so its readJson mock satisfies the generic dep signature. */
function mockReadJson(value: SessionRenameState): SessionAutoRenameDeps["readJson"] {
  return mock(() => ok(value)) as unknown as SessionAutoRenameDeps["readJson"];
}

import {
  buildTitle,
  extractKeywords,
  getStatePath,
  isConverged,
  mergeKeywords,
  SessionAutoRename,
  type SessionAutoRenameDeps,
  type SessionRenameState,
  shouldRename,
} from "./SessionAutoRename.contract";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASE_DIR = "/tmp/test-pai";
const SESSION_ID = "sess-abc123";
const NOW = 1_700_000_000_000;

function makeInput(
  prompt: string,
  overrides: Partial<UserPromptSubmitInput> = {},
): UserPromptSubmitInput {
  return { session_id: SESSION_ID, prompt, ...overrides };
}

function makeState(overrides: Partial<SessionRenameState> = {}): SessionRenameState {
  return {
    promptCount: 0,
    firstSeenAt: NOW - 60_000,
    lastRenameAt: 0,
    renameCount: 0,
    titleHistory: [],
    converged: false,
    customName: false,
    keywords: {},
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SessionAutoRenameDeps> = {}): SessionAutoRenameDeps {
  return {
    fileExists: mock(() => false),
    readJson: mock(() => err(new ResultError(ErrorCode.FileNotFound, "not found"))),
    writeJson: mock(() => ok(undefined)),
    ensureDir: mock(() => ok(undefined)),
    readConfig: mock(() => null),
    now: mock(() => NOW),
    baseDir: BASE_DIR,
    stderr: mock(() => {}),
    ...overrides,
  };
}

// ─── getStatePath ─────────────────────────────────────────────────────────────

describe("getStatePath", () => {
  it("returns correct MEMORY/STATE path", () => {
    const p = getStatePath("my-session", "/home/user/.claude");
    expect(p).toBe("/home/user/.claude/MEMORY/STATE/session-rename-my-session.json");
  });
});

// ─── extractKeywords ──────────────────────────────────────────────────────────

describe("extractKeywords", () => {
  it("lowercases and splits words", () => {
    const kws = extractKeywords("Implement the Feature");
    expect(kws).toContain("implement");
    expect(kws).toContain("feature");
  });

  it("filters stop words", () => {
    const kws = extractKeywords("and the is are with");
    expect(kws).toHaveLength(0);
  });

  it("filters words shorter than 4 chars", () => {
    const kws = extractKeywords("fix bug add run");
    // "fix", "bug", "add", "run" are all <= 3 chars or in stop words
    expect(kws).toHaveLength(0);
  });

  it("strips punctuation", () => {
    const kws = extractKeywords("implement session-rename hook!");
    expect(kws).toContain("implement");
    expect(kws).toContain("session");
    expect(kws).toContain("rename");
    expect(kws).toContain("hook");
  });

  it("returns empty array for empty string", () => {
    expect(extractKeywords("")).toHaveLength(0);
  });
});

// ─── mergeKeywords ────────────────────────────────────────────────────────────

describe("mergeKeywords", () => {
  it("adds new words with count 1", () => {
    const result = mergeKeywords({}, ["typescript", "testing"]);
    expect(result.typescript).toBe(1);
    expect(result.testing).toBe(1);
  });

  it("increments existing word counts", () => {
    const result = mergeKeywords({ typescript: 2 }, ["typescript"]);
    expect(result.typescript).toBe(3);
  });

  it("does not mutate existing object", () => {
    const existing = { typescript: 1 };
    mergeKeywords(existing, ["typescript"]);
    expect(existing.typescript).toBe(1);
  });
});

// ─── buildTitle ───────────────────────────────────────────────────────────────

describe("buildTitle", () => {
  it("returns null for empty keywords", () => {
    expect(buildTitle({})).toBeNull();
  });

  it("capitalises first letter of each word", () => {
    const title = buildTitle({ typescript: 3, testing: 2 });
    expect(title).toBe("Typescript Testing");
  });

  it("picks top 5 by frequency", () => {
    const kws = {
      alpha: 10,
      beta: 9,
      gamma: 8,
      delta: 7,
      epsilon: 6,
      zeta: 1,
      eta: 1,
    };
    const title = buildTitle(kws);
    expect(title).not.toContain("Zeta");
    expect(title).not.toContain("Eta");
    expect(title).toContain("Alpha");
  });

  it("handles single keyword", () => {
    expect(buildTitle({ typescript: 5 })).toBe("Typescript");
  });
});

// ─── isConverged ─────────────────────────────────────────────────────────────

describe("isConverged", () => {
  it("returns false when history shorter than convergenceCount", () => {
    expect(isConverged(["Title One"], 2)).toBe(false);
  });

  it("returns true when last N titles are identical", () => {
    expect(isConverged(["Old Title", "New Title", "New Title"], 2)).toBe(true);
  });

  it("returns false when last N titles differ", () => {
    expect(isConverged(["Title A", "Title B"], 2)).toBe(false);
  });

  it("returns true with convergenceCount 3", () => {
    expect(isConverged(["X", "Y", "Z", "Z", "Z"], 3)).toBe(true);
  });
});

// ─── shouldRename ─────────────────────────────────────────────────────────────

describe("shouldRename", () => {
  it("returns true on first prompt (lastRenameAt === 0)", () => {
    expect(shouldRename(makeState(), {}, NOW)).toBe(true);
  });

  it("returns false when already converged", () => {
    expect(shouldRename(makeState({ converged: true }), {}, NOW)).toBe(false);
  });

  it("returns false when customName is set", () => {
    expect(shouldRename(makeState({ customName: true }), {}, NOW)).toBe(false);
  });

  it("returns false when interval not elapsed", () => {
    const state = makeState({ lastRenameAt: NOW - 5 * 60 * 1000 }); // 5 min ago
    expect(shouldRename(state, { intervalMinutes: 15 }, NOW)).toBe(false);
  });

  it("returns true when interval has elapsed", () => {
    const state = makeState({ lastRenameAt: NOW - 20 * 60 * 1000 }); // 20 min ago
    expect(shouldRename(state, { intervalMinutes: 15 }, NOW)).toBe(true);
  });
});

// ─── SessionAutoRename.accepts ────────────────────────────────────────────────

describe("SessionAutoRename.accepts", () => {
  it("always returns true", () => {
    expect(SessionAutoRename.accepts(makeInput("anything"))).toBe(true);
    expect(SessionAutoRename.accepts(makeInput(""))).toBe(true);
  });
});

// ─── execute: disabled ────────────────────────────────────────────────────────

describe("SessionAutoRename.execute — disabled", () => {
  it("returns continue:true without sessionTitle when enabled:false", () => {
    const deps = makeDeps({ readConfig: mock(() => ({ enabled: false })) });
    const result = SessionAutoRename.execute(makeInput("implement a new feature"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
    expect(result.value.hookSpecificOutput).toBeUndefined();
  });

  it("does not write state when disabled", () => {
    const deps = makeDeps({ readConfig: mock(() => ({ enabled: false })) });
    SessionAutoRename.execute(makeInput("implement a new feature"), deps);
    expect((deps.writeJson as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });
});

// ─── execute: first prompt rename ─────────────────────────────────────────────

describe("SessionAutoRename.execute — first prompt rename", () => {
  it("returns sessionTitle on first meaningful prompt", () => {
    const deps = makeDeps();
    const result = SessionAutoRename.execute(
      makeInput("implement session rename feature typescript"),
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    // Type narrowing — sessionTitle is on UserPromptSubmit specific output
    const hs = result.value.hookSpecificOutput;
    if (hs && "sessionTitle" in hs) {
      expect(typeof hs.sessionTitle).toBe("string");
      expect((hs.sessionTitle ?? "").length).toBeGreaterThan(0);
    }
  });

  it("persists state to writeJson", () => {
    const deps = makeDeps();
    SessionAutoRename.execute(makeInput("implement feature typescript"), deps);

    const calls = (deps.writeJson as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [writePath, writeData] = calls[0];
    expect(writePath).toContain(`session-rename-${SESSION_ID}`);
    expect((writeData as SessionRenameState).promptCount).toBe(1);
    expect((writeData as SessionRenameState).renameCount).toBe(1);
  });

  it("calls ensureDir for state directory", () => {
    const deps = makeDeps();
    SessionAutoRename.execute(makeInput("implement feature"), deps);

    const calls = (deps.ensureDir as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0] as string).toContain("MEMORY/STATE");
  });
});

// ─── execute: no rename when interval not elapsed ─────────────────────────────

describe("SessionAutoRename.execute — interval guard", () => {
  it("returns no sessionTitle when interval has not elapsed", () => {
    const existingState = makeState({
      lastRenameAt: NOW - 5 * 60 * 1000, // 5 min ago
      promptCount: 3,
      keywords: { typescript: 5, implement: 4, feature: 3 },
    });

    const deps = makeDeps({
      fileExists: mock(() => true),
      readJson: mockReadJson(existingState),
      readConfig: mock(() => ({ intervalMinutes: 15 })),
    });

    const result = SessionAutoRename.execute(makeInput("check it out"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hookSpecificOutput).toBeUndefined();
  });

  it("still writes updated state (promptCount incremented) even without rename", () => {
    const existingState = makeState({
      lastRenameAt: NOW - 5 * 60 * 1000,
      promptCount: 3,
      keywords: { typescript: 5 },
    });

    const deps = makeDeps({
      fileExists: mock(() => true),
      readJson: mockReadJson(existingState),
      readConfig: mock(() => ({ intervalMinutes: 15 })),
    });

    SessionAutoRename.execute(makeInput("check it out"), deps);

    const calls = (deps.writeJson as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBe(1);
    expect((calls[0][1] as SessionRenameState).promptCount).toBe(4);
  });
});

// ─── execute: convergence ─────────────────────────────────────────────────────

describe("SessionAutoRename.execute — convergence", () => {
  it("marks converged after N identical titles", () => {
    // History already has (convergenceCount - 1) identical titles.
    // Keyword weights are high enough that adding a few new words won't
    // displace the top-5, keeping the title identical.
    const existingState = makeState({
      lastRenameAt: NOW - 20 * 60 * 1000, // eligible for rename
      renameCount: 1,
      titleHistory: ["Typescript Feature"],
      keywords: { typescript: 100, feature: 90 },
    });

    const deps = makeDeps({
      fileExists: mock(() => true),
      readJson: mockReadJson(existingState),
      readConfig: mock(() => ({ intervalMinutes: 15, convergenceCount: 2 })),
    });

    // Prompt adds "typescript" and "feature" again — title stays identical
    SessionAutoRename.execute(makeInput("typescript feature"), deps);

    const calls = (deps.writeJson as ReturnType<typeof mock>).mock.calls;
    const savedState = calls[0][1] as SessionRenameState;
    expect(savedState.converged).toBe(true);
  });

  it("returns no sessionTitle once converged", () => {
    const existingState = makeState({ converged: true });

    const deps = makeDeps({
      fileExists: mock(() => true),
      readJson: mockReadJson(existingState),
    });

    const result = SessionAutoRename.execute(makeInput("more work here please"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hookSpecificOutput).toBeUndefined();
  });
});

// ─── execute: customName guard ────────────────────────────────────────────────

describe("SessionAutoRename.execute — customName guard", () => {
  it("returns no sessionTitle when customName is set", () => {
    const existingState = makeState({ customName: true });

    const deps = makeDeps({
      fileExists: mock(() => true),
      readJson: mockReadJson(existingState),
    });

    const result = SessionAutoRename.execute(makeInput("work on typescript feature"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hookSpecificOutput).toBeUndefined();
  });
});

// ─── execute: corrupted state falls back gracefully ───────────────────────────

describe("SessionAutoRename.execute — resilience", () => {
  it("creates fresh state when stored state is corrupted", () => {
    const deps = makeDeps({
      fileExists: mock(() => true),
      readJson: mock(() => err(new ResultError(ErrorCode.JsonParseFailed, "corrupt json"))),
    });

    const result = SessionAutoRename.execute(makeInput("implement feature typescript"), deps);

    expect(result.ok).toBe(true);
    // Should still attempt a rename with fresh state
    if (!result.ok) return;
    const hs = result.value.hookSpecificOutput;
    if (hs && "sessionTitle" in hs) {
      expect(hs.sessionTitle).toBeDefined();
    }
  });

  it("always returns continue:true regardless of outcome", () => {
    const deps = makeDeps({
      writeJson: mock(() => err(new ResultError(ErrorCode.FileWriteFailed, "disk full"))),
    });

    const result = SessionAutoRename.execute(makeInput("implement feature"), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.continue).toBe(true);
  });
});

// ─── execute: empty / short prompt ───────────────────────────────────────────

describe("SessionAutoRename.execute — empty prompt", () => {
  it("returns no sessionTitle for prompt with no extractable keywords", () => {
    const deps = makeDeps();
    const result = SessionAutoRename.execute(makeInput(""), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hookSpecificOutput).toBeUndefined();
  });

  it("returns continue:true for empty prompt", () => {
    const deps = makeDeps();
    const result = SessionAutoRename.execute(makeInput(""), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.continue).toBe(true);
  });
});
