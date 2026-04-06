import { describe, expect, it } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import {
  countNewPages,
  type ExtractionJson,
  findTranscriptPath,
  hasExistingExtraction,
  isWikiOnlySession,
  parseExtractionFile,
  parseFilterOutput,
  WikiIngest,
  type WikiIngestDeps,
} from "./WikiIngest.contract";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<WikiIngestDeps> = {}): WikiIngestDeps {
  return {
    fileExists: () => false,
    readFile: () => ok(""),
    readDir: () => ok([]),
    appendFile: () => ok(undefined),
    ensureDir: () => ok(undefined),
    stat: () => ok({ mtimeMs: Date.now() }),
    exec: async () => ok({ stdout: "", stderr: "", exitCode: 0 }),
    getTimestamp: () => "2026-04-06T15:00:00+11:00",
    baseDir: "/tmp/test-pai",
    pipelineDir: "/tmp/test-pai/MEMORY/WIKI/.pipeline",
    stderr: () => {},
    ...overrides,
  };
}

function makeInput(overrides: Partial<SessionEndInput> = {}): SessionEndInput {
  return { session_id: "test-session-abc123", ...overrides };
}

// ─── Contract Metadata ──────────────────────────────────────────────────────

describe("WikiIngest contract", () => {
  it("has correct name and event", () => {
    expect(WikiIngest.name).toBe("WikiIngest");
    expect(WikiIngest.event).toBe("SessionEnd");
  });

  it("accepts all SessionEnd inputs", () => {
    expect(WikiIngest.accepts(makeInput())).toBe(true);
    expect(WikiIngest.accepts(makeInput({ session_id: "" }))).toBe(true);
  });
});

// ─── findTranscriptPath ─────────────────────────────────────────────────────

describe("findTranscriptPath", () => {
  it("returns transcript_path when present and exists", () => {
    const deps = makeDeps({
      fileExists: (path: string) => path === "/tmp/transcript.jsonl",
    });
    const input = makeInput({ transcript_path: "/tmp/transcript.jsonl" });
    expect(findTranscriptPath(input, deps)).toBe("/tmp/transcript.jsonl");
  });

  it("returns null when transcript_path does not exist on disk", () => {
    const deps = makeDeps({ fileExists: () => false, readDir: () => ok([]) });
    const input = makeInput({ transcript_path: "/tmp/missing.jsonl" });
    expect(findTranscriptPath(input, deps)).toBeNull();
  });

  it("searches projects dir when no transcript_path", () => {
    const deps = makeDeps({
      fileExists: (path: string) =>
        path === "/tmp/test-pai/projects/myproject/test-session-abc123.jsonl",
      readDir: () => ok(["myproject"]),
    });
    const result = findTranscriptPath(makeInput(), deps);
    expect(result).toBe("/tmp/test-pai/projects/myproject/test-session-abc123.jsonl");
  });

  it("returns null when no transcript found anywhere", () => {
    const deps = makeDeps({ readDir: () => ok(["proj1"]) });
    expect(findTranscriptPath(makeInput(), deps)).toBeNull();
  });
});

// ─── isWikiOnlySession ──────────────────────────────────────────────────────

describe("isWikiOnlySession", () => {
  it("returns true when only wiki paths are touched", () => {
    const content = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/Users/h/.claude/MEMORY/WIKI/entities/pai.md"}}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/Users/h/.claude/MEMORY/WIKI/concepts/hooks.md"}}]}}',
    ].join("\n");
    expect(isWikiOnlySession(content)).toBe(true);
  });

  it("returns false when non-wiki paths are touched", () => {
    const content = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/Users/h/.claude/pai-hooks/hooks/Test.ts"}}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/Users/h/.claude/MEMORY/WIKI/entities/pai.md"}}]}}',
    ].join("\n");
    expect(isWikiOnlySession(content)).toBe(false);
  });

  it("returns false when no file paths found (not a wiki-only session by default)", () => {
    const content = '{"type":"user","message":{"content":"hello"}}';
    expect(isWikiOnlySession(content)).toBe(false);
  });
});

// ─── hasExistingExtraction ──────────────────────────────────────────────────

describe("hasExistingExtraction", () => {
  it("returns true when extraction JSON exists", () => {
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("test-session.json"),
    });
    expect(hasExistingExtraction("test-session", deps)).toBe(true);
  });

  it("returns false when no extraction exists", () => {
    const deps = makeDeps({ fileExists: () => false });
    expect(hasExistingExtraction("test-session", deps)).toBe(false);
  });
});

// ─── parseFilterOutput ──────────────────────────────────────────────────────

describe("parseFilterOutput", () => {
  it("parses valid filter JSON output", () => {
    const json = JSON.stringify({
      sessionId: "abc",
      classification: "standard",
      digestPath: "/tmp/digests/abc.md",
      messageCount: 20,
      keptMessageCount: 8,
      decisionsFound: 2,
      entitiesFound: ["pai"],
      confidence: "medium",
    });
    const result = parseFilterOutput(json);
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("abc");
    expect(result!.classification).toBe("standard");
    expect(result!.digestPath).toBe("/tmp/digests/abc.md");
  });

  it("returns null for non-JSON output", () => {
    expect(parseFilterOutput("not json")).toBeNull();
  });

  it("returns null for JSON without sessionId", () => {
    expect(parseFilterOutput('{"foo": "bar"}')).toBeNull();
  });
});

// ─── parseExtractionFile ────────────────────────────────────────────────────

describe("parseExtractionFile", () => {
  it("parses valid extraction JSON", () => {
    const json = JSON.stringify({
      sessionId: "abc",
      entities: [{ name: "PAI", type: "project", description: "AI infra" }],
      decisions: ["chose hooks over plugins"],
      concepts: [{ name: "DI", description: "dependency injection" }],
      confidence: "high",
      cost: { inputTokens: 100, outputTokens: 50, totalCost: 0.001 },
    });
    const result = parseExtractionFile(json);
    expect(result).not.toBeNull();
    expect(result!.entities).toHaveLength(1);
    expect(result!.cost.totalCost).toBe(0.001);
  });

  it("returns null for invalid JSON", () => {
    expect(parseExtractionFile("not json")).toBeNull();
  });
});

// ─── countNewPages ──────────────────────────────────────────────────────────

describe("countNewPages", () => {
  it("counts entities and concepts that do not already exist", () => {
    const extraction: ExtractionJson = {
      sessionId: "abc",
      entities: [
        { name: "PAI", type: "project", description: "AI infra" },
        { name: "Koord", type: "project", description: "Coordination" },
      ],
      decisions: [],
      concepts: [{ name: "Hook System", description: "event hooks" }],
      confidence: "high",
      cost: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
    };
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("pai.md"), // PAI already exists
    });
    // Koord entity + Hook System concept = 2 new pages
    expect(countNewPages(extraction, deps)).toBe(2);
  });

  it("returns 0 when all pages already exist", () => {
    const extraction: ExtractionJson = {
      sessionId: "abc",
      entities: [{ name: "PAI", type: "project", description: "AI infra" }],
      decisions: [],
      concepts: [],
      confidence: "high",
      cost: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
    };
    const deps = makeDeps({ fileExists: () => true });
    expect(countNewPages(extraction, deps)).toBe(0);
  });
});

// ─── Execute Integration Tests ──────────────────────────────────────────────

describe("WikiIngest.execute", () => {
  it("skips when no session_id", async () => {
    const messages: string[] = [];
    const deps = makeDeps({ stderr: (msg) => messages.push(msg) });
    const result = await WikiIngest.execute(makeInput({ session_id: "" }), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
    expect(messages.some((m) => m.includes("No session_id"))).toBe(true);
  });

  it("skips when no transcript found", async () => {
    const messages: string[] = [];
    const deps = makeDeps({
      readDir: () => ok([]),
      stderr: (msg) => messages.push(msg),
    });
    const result = await WikiIngest.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(messages.some((m) => m.includes("No transcript found"))).toBe(true);
  });

  it("skips when transcript is below size gate", async () => {
    const messages: string[] = [];
    const smallContent = "x".repeat(1000); // 1KB, below 5KB gate
    const deps = makeDeps({
      fileExists: (path: string) => path === "/tmp/transcript.jsonl",
      readFile: () => ok(smallContent),
      stat: () => ok({ mtimeMs: Date.now() }),
      stderr: (msg) => messages.push(msg),
    });
    const result = await WikiIngest.execute(
      makeInput({ transcript_path: "/tmp/transcript.jsonl" }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect(messages.some((m) => m.includes("too small"))).toBe(true);
  });

  it("skips wiki-only sessions", async () => {
    const messages: string[] = [];
    const wikiContent = 'file_path":"/home/user/.claude/MEMORY/WIKI/entities/test.md"\n'.repeat(
      200,
    );
    const deps = makeDeps({
      fileExists: (path: string) => path === "/tmp/transcript.jsonl",
      readFile: () => ok(wikiContent),
      stat: () => ok({ mtimeMs: Date.now() }),
      stderr: (msg) => messages.push(msg),
    });
    const result = await WikiIngest.execute(
      makeInput({ transcript_path: "/tmp/transcript.jsonl" }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect(messages.some((m) => m.includes("Wiki-only session"))).toBe(true);
  });

  it("skips already-extracted sessions", async () => {
    const messages: string[] = [];
    const bigContent = 'file_path":"/home/user/project/src/main.ts"\n'.repeat(200);
    const deps = makeDeps({
      fileExists: (path: string) => path === "/tmp/transcript.jsonl" || path.endsWith(".json"),
      readFile: () => ok(bigContent),
      stat: () => ok({ mtimeMs: Date.now() }),
      stderr: (msg) => messages.push(msg),
    });
    const result = await WikiIngest.execute(
      makeInput({ transcript_path: "/tmp/transcript.jsonl" }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect(messages.some((m) => m.includes("already extracted"))).toBe(true);
  });

  it("runs full pipeline when all gates pass", async () => {
    const messages: string[] = [];
    const appendedContent: string[] = [];
    const bigContent = 'file_path":"/home/user/project/src/main.ts"\n'.repeat(200);

    const filterOutput = JSON.stringify({
      sessionId: "test-session-abc123",
      classification: "standard",
      digestPath: "/tmp/test-pai/MEMORY/WIKI/.pipeline/digests/test-session-abc123.md",
      messageCount: 20,
      keptMessageCount: 8,
      decisionsFound: 1,
      entitiesFound: ["pai"],
      confidence: "medium",
    });

    const extractionJson = JSON.stringify({
      sessionId: "test-session-abc123",
      entities: [{ name: "PAI", type: "project", description: "AI infra" }],
      decisions: ["chose hooks"],
      concepts: [],
      confidence: "high",
      cost: { inputTokens: 100, outputTokens: 50, totalCost: 0.001 },
    });

    let execCallCount = 0;
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path === "/tmp/transcript.jsonl") return true;
        if (path.endsWith("test-session-abc123.json") && execCallCount >= 2) return false;
        return false;
      },
      readFile: (path: string) => {
        if (path === "/tmp/transcript.jsonl") return ok(bigContent);
        if (path.endsWith(".json")) return ok(extractionJson);
        return ok("");
      },
      stat: () => ok({ mtimeMs: Date.now() }),
      appendFile: (_path: string, content: string) => {
        appendedContent.push(content);
        return ok(undefined);
      },
      exec: async (cmd: string) => {
        execCallCount++;
        if (cmd.includes("filter.ts")) {
          return ok({ stdout: filterOutput, stderr: "", exitCode: 0 });
        }
        if (cmd.includes("extract.ts")) {
          return ok({ stdout: '{"ok":true}', stderr: "", exitCode: 0 });
        }
        if (cmd.includes("seed.ts")) {
          return ok({ stdout: "seeded", stderr: "", exitCode: 0 });
        }
        return ok({ stdout: "", stderr: "", exitCode: 0 });
      },
      stderr: (msg) => messages.push(msg),
    });

    const result = await WikiIngest.execute(
      makeInput({ transcript_path: "/tmp/transcript.jsonl" }),
      deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
    expect(messages.some((m) => m.includes("Filter complete"))).toBe(true);
    expect(messages.some((m) => m.includes("Extraction complete"))).toBe(true);
    expect(messages.some((m) => m.includes("Done"))).toBe(true);

    // Audit trail was written
    expect(appendedContent.length).toBeGreaterThan(0);
    const auditLine = JSON.parse(appendedContent[0]);
    expect(auditLine.session_id).toBe("test-session-abc123");
    expect(auditLine.classification).toBe("standard");
  });

  it("handles filter exec failure gracefully", async () => {
    const messages: string[] = [];
    const bigContent = 'file_path":"/home/user/project/src/main.ts"\n'.repeat(200);
    const execError = new ResultError(ErrorCode.ProcessExecFailed, "timeout");

    const deps = makeDeps({
      fileExists: (path: string) => path === "/tmp/transcript.jsonl",
      readFile: () => ok(bigContent),
      stat: () => ok({ mtimeMs: Date.now() }),
      exec: async () => err(execError),
      stderr: (msg) => messages.push(msg),
    });

    const result = await WikiIngest.execute(
      makeInput({ transcript_path: "/tmp/transcript.jsonl" }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect(messages.some((m) => m.includes("Filter exec failed"))).toBe(true);
  });

  it("handles filter non-zero exit gracefully", async () => {
    const messages: string[] = [];
    const bigContent = 'file_path":"/home/user/project/src/main.ts"\n'.repeat(200);

    const deps = makeDeps({
      fileExists: (path: string) => path === "/tmp/transcript.jsonl",
      readFile: () => ok(bigContent),
      stat: () => ok({ mtimeMs: Date.now() }),
      exec: async () => ok({ stdout: "", stderr: "error occurred", exitCode: 1 }),
      stderr: (msg) => messages.push(msg),
    });

    const result = await WikiIngest.execute(
      makeInput({ transcript_path: "/tmp/transcript.jsonl" }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect(messages.some((m) => m.includes("Filter failed"))).toBe(true);
  });

  it("writes audit entry when filter produces no digest", async () => {
    const messages: string[] = [];
    const appendedContent: string[] = [];
    const bigContent = 'file_path":"/home/user/project/src/main.ts"\n'.repeat(200);

    const filterOutput = JSON.stringify({
      sessionId: "test-session-abc123",
      classification: "skip",
      digestPath: null,
      messageCount: 3,
      keptMessageCount: 0,
      decisionsFound: 0,
      entitiesFound: [],
      confidence: "low",
    });

    const deps = makeDeps({
      fileExists: (path: string) => path === "/tmp/transcript.jsonl",
      readFile: () => ok(bigContent),
      stat: () => ok({ mtimeMs: Date.now() }),
      exec: async () => ok({ stdout: filterOutput, stderr: "", exitCode: 0 }),
      appendFile: (_path: string, content: string) => {
        appendedContent.push(content);
        return ok(undefined);
      },
      stderr: (msg) => messages.push(msg),
    });

    const result = await WikiIngest.execute(
      makeInput({ transcript_path: "/tmp/transcript.jsonl" }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect(appendedContent.length).toBe(2);
    const audit = JSON.parse(appendedContent[0]);
    expect(audit.skipped).toBe(true);
    expect(audit.skipReason).toBe("no digest produced");
    expect(appendedContent[1]).toContain("## [");
    expect(appendedContent[1]).toContain("skipped: no digest produced");
  });

  it("logs milestone at extraction count multiples of 50", async () => {
    const messages: string[] = [];
    const bigContent = 'file_path":"/home/user/project/src/main.ts"\n'.repeat(200);

    // Stateful audit content — starts with 49 lines, grows on append
    let auditContent = `${new Array(49).fill('{"session_id":"x"}').join("\n")}\n`;

    const filterOutput = JSON.stringify({
      sessionId: "test-session-abc123",
      classification: "standard",
      digestPath: "/tmp/digests/test-session-abc123.md",
      messageCount: 20,
      keptMessageCount: 8,
      decisionsFound: 0,
      entitiesFound: [],
      confidence: "low",
    });

    const extractionJson = JSON.stringify({
      sessionId: "test-session-abc123",
      entities: [],
      decisions: [],
      concepts: [],
      confidence: "low",
      cost: { inputTokens: 50, outputTokens: 25, totalCost: 0.0001 },
    });

    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path === "/tmp/transcript.jsonl") return true;
        return false;
      },
      readFile: (path: string) => {
        if (path === "/tmp/transcript.jsonl") return ok(bigContent);
        if (path.endsWith("audit.jsonl")) return ok(auditContent);
        if (path.endsWith(".json")) return ok(extractionJson);
        return ok("");
      },
      stat: () => ok({ mtimeMs: Date.now() }),
      exec: async (cmd: string) => {
        if (cmd.includes("filter.ts")) {
          return ok({ stdout: filterOutput, stderr: "", exitCode: 0 });
        }
        if (cmd.includes("extract.ts")) {
          return ok({ stdout: "{}", stderr: "", exitCode: 0 });
        }
        return ok({ stdout: "", stderr: "", exitCode: 0 });
      },
      appendFile: (path: string, content: string) => {
        if (path.endsWith("audit.jsonl")) auditContent += content;
        return ok(undefined);
      },
      stderr: (msg) => messages.push(msg),
    });

    await WikiIngest.execute(makeInput({ transcript_path: "/tmp/transcript.jsonl" }), deps);

    // After writeAuditEntry appends 1 line to the 49 existing, getExtractionCount
    // reads the updated auditContent (50 lines) and triggers the milestone log.
    expect(messages.some((m) => m.includes("Milestone") && m.includes("50"))).toBe(true);
  });
});
