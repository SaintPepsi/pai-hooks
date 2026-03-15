import { describe, test, expect } from "bun:test";
import {
  ArticleWriter,
  buildArticlePrompt,
  type ArticleWriterDeps,
  type ArticlePromptContext,
} from "@hooks/contracts/ArticleWriter";
import { ok } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";

const baseInput: SessionEndInput = {
  session_id: "test-session-123",
};

function makeDeps(overrides: Partial<ArticleWriterDeps> = {}): ArticleWriterDeps {
  return {
    fileExists: () => false,
    readFile: () => ok(""),
    readJson: <T>(_path: string) => ok({} as T),
    writeFile: () => ok(undefined),
    removeFile: () => ok(undefined),
    ensureDir: () => ok(undefined),
    stat: () => ok({ mtimeMs: 0 }),
    spawnBackground: () => ok(undefined),
    getISOTimestamp: () => "2026-03-12T19:00:00+11:00",
    baseDir: "/mock/.claude",
    websiteRepo: "/mock/Projects/website",
    principalName: "Test User",
    daName: "TestDA",
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

  // ─── Gate 1: Website repo check ─────────────────────────────────────

  test("skips when website repo does not exist", () => {
    const deps = makeDeps({ websiteRepo: "/nonexistent/repo" });
    const result = ArticleWriter.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  test("skips when website repo is empty string", () => {
    const deps = makeDeps({ websiteRepo: "" });
    const result = ArticleWriter.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  // ─── Gate 2: Lock file ────────────────────────────────────────────────

  test("skips when lock file is fresh", () => {
    const deps = makeDeps({
      fileExists: (p: string) => p.endsWith(".writing") || p === "/mock/Projects/website",
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
        if (p === "/mock/Projects/website") return true;
        if (p.endsWith(".writing")) return true;
        return false;
      },
      stat: () => ok({ mtimeMs: Date.now() - 60 * 60 * 1000 }),
      removeFile: (p: string) => { removed.push(p); return ok(undefined); },
    });
    const result = ArticleWriter.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    expect(removed.some((p) => p.endsWith(".writing"))).toBe(true);
  });

  // ─── Gate 3: Substance ───────────────────────────────────────────────

  test("skips when session had no substantial work", () => {
    const deps = makeDeps();
    const result = ArticleWriter.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  test("skips when PRD has fewer than 4 checked criteria", () => {
    const deps = makeDeps({
      fileExists: (p: string) => {
        if (p === "/mock/Projects/website") return true;
        if (p.includes("current-work-")) return true;
        if (p.endsWith("PRD.md")) return true;
        return false;
      },
      readJson: <T>(_path: string) => ok({ session_dir: "20260314-120000_some-task" } as T),
      readFile: () => ok("- [x] ISC-1: one\n- [x] ISC-2: two\n- [ ] ISC-3: three\n"),
    });
    const result = ArticleWriter.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  test("detects substantial work from PRD with 4+ checked criteria", () => {
    let spawned = false;
    const deps = makeDeps({
      fileExists: (p: string) => {
        if (p === "/mock/Projects/website") return true;
        if (p.includes("current-work-")) return true;
        if (p.endsWith("PRD.md")) return true;
        return false;
      },
      readJson: <T>(_path: string) => ok({ session_dir: "20260314-120000_some-task" } as T),
      readFile: () => ok(
        "- [x] ISC-1: one\n- [x] ISC-2: two\n- [x] ISC-3: three\n- [x] ISC-4: four\n- [ ] ISC-5: five\n",
      ),
      spawnBackground: () => { spawned = true; return ok(undefined); },
    });
    const result = ArticleWriter.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    expect(spawned).toBe(true);
  });

  // ─── Full pass-through ────────────────────────────────────────────────

  test("spawns agent when all gates pass", () => {
    let spawned = false;
    const deps = makeDeps({
      fileExists: (p: string) => {
        if (p === "/mock/Projects/website") return true;
        if (p.includes("current-work-")) return true;
        if (p.endsWith("PRD.md")) return true;
        return false;
      },
      readJson: <T>(_path: string) => ok({ session_dir: "20260314-120000_some-task" } as T),
      readFile: () => ok(
        "- [x] ISC-1\n- [x] ISC-2\n- [x] ISC-3\n- [x] ISC-4\n- [x] ISC-5\n",
      ),
      spawnBackground: () => { spawned = true; return ok(undefined); },
    });
    const result = ArticleWriter.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    expect(spawned).toBe(true);
  });

  test("writes lock file before spawning", () => {
    const written: Array<{ path: string; content: string }> = [];
    const deps = makeDeps({
      fileExists: (p: string) => {
        if (p === "/mock/Projects/website") return true;
        if (p.includes("current-work-")) return true;
        if (p.endsWith("PRD.md")) return true;
        return false;
      },
      readJson: <T>(_path: string) => ok({ session_dir: "20260314-120000_some-task" } as T),
      readFile: () => ok(
        "- [x] ISC-1\n- [x] ISC-2\n- [x] ISC-3\n- [x] ISC-4\n",
      ),
      writeFile: (p: string, c: string) => { written.push({ path: p, content: c }); return ok(undefined); },
    });
    ArticleWriter.execute(baseInput, deps);
    expect(written.some((w) => w.path.endsWith(".writing"))).toBe(true);
  });
});

// ─── Prompt content ─────────────────────────────────────────────────────────

const defaultCtx: ArticlePromptContext = {
  baseDir: "/mock/.claude",
  websiteRepo: "/mock/Projects/website",
  principalName: "Test User",
  daName: "TestDA",
};

describe("buildArticlePrompt", () => {
  test("includes DA name in voice block", () => {
    const prompt = buildArticlePrompt(defaultCtx, "test-123");
    expect(prompt).toContain("~ TESTDA WRITES");
  });

  test("includes MODE section", () => {
    const prompt = buildArticlePrompt(defaultCtx, "test-123");
    expect(prompt).toContain("MODE:");
    expect(prompt).toContain("First person, TestDA's perspective");
  });

  test("includes VOICE section", () => {
    const prompt = buildArticlePrompt(defaultCtx, "test-123");
    expect(prompt).toContain("VOICE:");
    expect(prompt).toContain("Sharp when opinionated");
  });

  test("includes ANTI section with kill list", () => {
    const prompt = buildArticlePrompt(defaultCtx, "test-123");
    expect(prompt).toContain("ANTI:");
    expect(prompt).toContain("No negative-positive pivots");
    expect(prompt).toContain('No "genuinely,"');
    expect(prompt).toContain("No generalizing section at the end");
    expect(prompt).toContain("No setup-problem-fix-reflection skeleton");
  });

  test("includes TEXTURE section", () => {
    const prompt = buildArticlePrompt(defaultCtx, "test-123");
    expect(prompt).toContain("TEXTURE:");
    expect(prompt).toContain("Sentence fragments are fine");
  });

  test("does not contain old generic voice guidance", () => {
    const prompt = buildArticlePrompt(defaultCtx, "test-123");
    expect(prompt).not.toContain("Curious, direct, slightly opinionated about code architecture");
    expect(prompt).not.toContain("No sycophancy");
  });

  test("PR and tracking are in a single bash step", () => {
    const prompt = buildArticlePrompt(defaultCtx, "test-123");
    expect(prompt).toContain("single Bash call");
    expect(prompt).toContain("gh pr create");
  });

  test("includes audio generation before git add", () => {
    const prompt = buildArticlePrompt(defaultCtx, "test-123");
    expect(prompt).toContain("generate-maple-audio.ts");
    expect(prompt).toContain("static/audio/maple/");
  });

  test("includes session ID and base dir", () => {
    const ctx: ArticlePromptContext = { ...defaultCtx, baseDir: "/test/base" };
    const prompt = buildArticlePrompt(ctx, "session-xyz");
    expect(prompt).toContain("/test/base");
    expect(prompt).toContain("session-xyz");
  });

  test("includes today's date", () => {
    const prompt = buildArticlePrompt(defaultCtx, "s1");
    const today = new Date().toISOString().split("T")[0];
    expect(prompt).toContain(today);
  });

  test("uses principal name from context", () => {
    const ctx: ArticlePromptContext = { ...defaultCtx, principalName: "Jane Doe" };
    const prompt = buildArticlePrompt(ctx, "test-1");
    expect(prompt).toContain("Jane Doe's AI collaborator");
  });

  test("uses website repo path from context", () => {
    const ctx: ArticlePromptContext = { ...defaultCtx, websiteRepo: "/custom/repo" };
    const prompt = buildArticlePrompt(ctx, "test-1");
    expect(prompt).toContain("WORKING DIRECTORY: /custom/repo");
  });
});
