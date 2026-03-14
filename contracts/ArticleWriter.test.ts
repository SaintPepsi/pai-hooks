import { describe, test, expect } from "bun:test";
import {
  ArticleWriter,
  buildArticlePrompt,
  type ArticleWriterDeps,
} from "@hooks/contracts/ArticleWriter";
import { ok, err } from "@hooks/core/result";
import { ioFailed } from "@hooks/core/error";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";

const baseInput: SessionEndInput = {
  session_id: "test-session-123",
};

function makeDeps(overrides: Partial<ArticleWriterDeps> = {}): ArticleWriterDeps {
  return {
    fileExists: () => false,
    readDir: () => ok([]),
    readJson: () => ok({}),
    writeFile: () => ok(undefined),
    removeFile: () => ok(undefined),
    ensureDir: () => ok(undefined),
    stat: () => ok({ mtimeMs: 0 }),
    spawnBackground: () => ok(undefined),
    getISOTimestamp: () => "2026-03-12T19:00:00+11:00",
    homeDir: "/Users/hogers",
    baseDir: "/Users/hogers/.claude",
    stderr: () => {},
    ...overrides,
  };
}

// ─── Contract metadata ──────────────────────────────────────────────────────

describe("ArticleWriter", () => {
  test("name is ArticleWriter", () => {
    expect(ArticleWriter.name).toBe("ArticleWriter");
  });

  test("event is SessionEnd", () => {
    expect(ArticleWriter.event).toBe("SessionEnd");
  });

  test("accepts inputs with session_id", () => {
    expect(ArticleWriter.accepts(baseInput)).toBe(true);
  });

  test("rejects inputs without session_id", () => {
    expect(ArticleWriter.accepts({ session_id: "" })).toBe(false);
  });

  // ─── Gating logic ──────────────────────────────────────────────────────

  test("skips on non-target machine", () => {
    const deps = makeDeps({ homeDir: "/home/other" });
    const result = ArticleWriter.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  test("skips when lock file is fresh", () => {
    const deps = makeDeps({
      fileExists: (p: string) => p.endsWith(".writing"),
      stat: () => ok({ mtimeMs: Date.now() - 1000 }),
    });
    const result = ArticleWriter.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  test("cleans stale lock and continues", () => {
    const removed: string[] = [];
    const deps = makeDeps({
      fileExists: (p: string) => {
        if (p.endsWith(".writing")) return true;
        return false;
      },
      stat: () => ok({ mtimeMs: Date.now() - 60 * 60 * 1000 }),
      removeFile: (p: string) => { removed.push(p); return ok(undefined); },
      // No substance, so will still skip after lock cleanup
    });
    const result = ArticleWriter.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    expect(removed.some((p) => p.endsWith(".writing"))).toBe(true);
  });

  test("skips when session counter below threshold", () => {
    const deps = makeDeps({
      readJson: (p: string) => {
        if (p.endsWith(".session-counter.json")) return ok({ count: 10 });
        return ok({});
      },
    });
    const result = ArticleWriter.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  test("increments counter on each session end", () => {
    const written: Array<{ path: string; content: string }> = [];
    const deps = makeDeps({
      readJson: (p: string) => {
        if (p.endsWith(".session-counter.json")) return ok({ count: 5 });
        return ok({});
      },
      writeFile: (p: string, c: string) => { written.push({ path: p, content: c }); return ok(undefined); },
    });
    ArticleWriter.execute(baseInput, deps);
    const counterWrite = written.find((w) => w.path.endsWith(".session-counter.json"));
    expect(counterWrite).toBeDefined();
    expect(JSON.parse(counterWrite!.content).count).toBe(6);
  });

  test("resets counter and proceeds when threshold reached", () => {
    let spawned = false;
    const written: Array<{ path: string; content: string }> = [];
    const deps = makeDeps({
      readJson: (p: string) => {
        if (p.endsWith(".session-counter.json")) return ok({ count: 24 });
        if (p.includes("algorithms")) return ok({ criteria: [1, 2, 3, 4] });
        return ok({});
      },
      fileExists: (p: string) => p.includes("algorithms"),
      writeFile: (p: string, c: string) => { written.push({ path: p, content: c }); return ok(undefined); },
      spawnBackground: () => { spawned = true; return ok(undefined); },
    });
    ArticleWriter.execute(baseInput, deps);
    const counterReset = written.find((w) =>
      w.path.endsWith(".session-counter.json") && JSON.parse(w.content).count === 0
    );
    expect(counterReset).toBeDefined();
    expect(spawned).toBe(true);
  });

  test("skips when session had no substantial work", () => {
    const deps = makeDeps();
    const result = ArticleWriter.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  test("spawns agent when all gates pass", () => {
    let spawned = false;
    const deps = makeDeps({
      fileExists: (p: string) => {
        if (p.includes("algorithms")) return true;
        return false;
      },
      readJson: (p: string) => {
        if (p.endsWith(".session-counter.json")) return ok({ count: 24 });
        return ok({ criteria: [1, 2, 3, 4] });
      },
      spawnBackground: () => { spawned = true; return ok(undefined); },
    });
    const result = ArticleWriter.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    expect(spawned).toBe(true);
  });
});

// ─── Prompt content ─────────────────────────────────────────────────────────

describe("buildArticlePrompt", () => {
  test("includes MAPLE WRITES voice block", () => {
    const prompt = buildArticlePrompt("/Users/hogers/.claude", "test-123");
    expect(prompt).toContain("~ MAPLE WRITES");
  });

  test("includes MODE section", () => {
    const prompt = buildArticlePrompt("/Users/hogers/.claude", "test-123");
    expect(prompt).toContain("MODE:");
    expect(prompt).toContain("First person, Maple's perspective");
  });

  test("includes VOICE section", () => {
    const prompt = buildArticlePrompt("/Users/hogers/.claude", "test-123");
    expect(prompt).toContain("VOICE:");
    expect(prompt).toContain("Sharp when opinionated");
  });

  test("includes ANTI section with kill list", () => {
    const prompt = buildArticlePrompt("/Users/hogers/.claude", "test-123");
    expect(prompt).toContain("ANTI:");
    expect(prompt).toContain("No negative-positive pivots");
    expect(prompt).toContain('No "genuinely,"');
    expect(prompt).toContain("No generalizing section at the end");
    expect(prompt).toContain("No setup-problem-fix-reflection skeleton");
  });

  test("includes TEXTURE section", () => {
    const prompt = buildArticlePrompt("/Users/hogers/.claude", "test-123");
    expect(prompt).toContain("TEXTURE:");
    expect(prompt).toContain("Sentence fragments are fine");
  });

  test("does not contain old generic voice guidance", () => {
    const prompt = buildArticlePrompt("/Users/hogers/.claude", "test-123");
    expect(prompt).not.toContain("Curious, direct, slightly opinionated about code architecture");
    expect(prompt).not.toContain("No sycophancy");
  });

  test("PR and tracking are in a single bash step", () => {
    const prompt = buildArticlePrompt("/Users/hogers/.claude", "test-123");
    expect(prompt).toContain("single Bash call");
    expect(prompt).toContain("gh pr create");
  });

  test("includes audio generation before git add", () => {
    const prompt = buildArticlePrompt("/Users/hogers/.claude", "test-123");
    expect(prompt).toContain("generate-maple-audio.ts");
    expect(prompt).toContain("public/audio/maple/");
  });

  test("includes session ID and base dir", () => {
    const prompt = buildArticlePrompt("/test/base", "session-xyz");
    expect(prompt).toContain("/test/base");
    expect(prompt).toContain("session-xyz");
  });

  test("includes today's date", () => {
    const prompt = buildArticlePrompt("/test", "s1");
    const today = new Date().toISOString().split("T")[0];
    expect(prompt).toContain(today);
  });
});
