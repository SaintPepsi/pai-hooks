import { describe, expect, test } from "bun:test";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import {
  RelationshipMemory,
  type RelationshipMemoryDeps,
  safeParseTranscriptLine,
} from "./RelationshipMemory.contract";

// ─── Types (mirrored for test use) ───────────────────────────────────────────

interface TranscriptEntry {
  type: "user" | "assistant";
  message?: { content: string | Array<{ type: string; text?: string }> };
}

interface RelationshipNote {
  type: "W" | "B" | "O";
  entities: string[];
  content: string;
  confidence?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<StopInput> = {}): StopInput {
  return {
    transcript_path: "/tmp/test-transcript.jsonl",
    session_id: "test-session",
    ...overrides,
  };
}

function makeDeps(
  entries: TranscriptEntry[],
  overrides: Partial<RelationshipMemoryDeps> = {},
): RelationshipMemoryDeps & { capturedNotes: RelationshipNote[]; stderrLines: string[] } {
  const capturedNotes: RelationshipNote[] = [];
  const stderrLines: string[] = [];
  return {
    readTranscript: (_path: string) => entries,
    analyzeForRelationship: (_e: TranscriptEntry[]) => {
      // Default: return empty — tests that need notes override this
      return [];
    },
    writeNotes: (notes: RelationshipNote[]) => {
      capturedNotes.push(...notes);
    },
    stderr: (msg: string) => {
      stderrLines.push(msg);
    },
    capturedNotes,
    stderrLines,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("RelationshipMemory", () => {
  describe("accepts", () => {
    test("returns true when transcript_path is present", () => {
      expect(RelationshipMemory.accepts(makeInput())).toBe(true);
    });

    test("returns false when transcript_path is empty string", () => {
      expect(RelationshipMemory.accepts(makeInput({ transcript_path: "" }))).toBe(false);
    });

    test("returns false when transcript_path is undefined", () => {
      const input: Partial<StopInput> = makeInput();
      delete input.transcript_path;
      expect(RelationshipMemory.accepts(input as StopInput)).toBe(false);
    });
  });

  describe("execute — no transcript entries", () => {
    test("returns silent output when entries array is empty", () => {
      const deps = makeDeps([]);
      const result = RelationshipMemory.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("silent");
      }
    });

    test("does not call writeNotes when entries array is empty", () => {
      const deps = makeDeps([]);
      RelationshipMemory.execute(makeInput(), deps);
      expect(deps.capturedNotes).toHaveLength(0);
    });

    test("logs skip message when entries array is empty", () => {
      const deps = makeDeps([]);
      RelationshipMemory.execute(makeInput(), deps);
      expect(deps.stderrLines.some((l) => l.includes("skipping"))).toBe(true);
    });
  });

  describe("execute — no notes extracted", () => {
    test("returns silent output when analyzeForRelationship returns empty", () => {
      const entries: TranscriptEntry[] = [{ type: "user", message: { content: "Hello there" } }];
      const deps = makeDeps(entries);
      const result = RelationshipMemory.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("silent");
      }
    });

    test("does not call writeNotes when no notes extracted", () => {
      const entries: TranscriptEntry[] = [{ type: "user", message: { content: "Hello there" } }];
      const deps = makeDeps(entries);
      RelationshipMemory.execute(makeInput(), deps);
      expect(deps.capturedNotes).toHaveLength(0);
    });
  });

  describe("execute — with positive pattern notes (O type)", () => {
    test("writeNotes is called with O-type note for positives", () => {
      const entries: TranscriptEntry[] = [{ type: "user", message: { content: "some content" } }];
      const oNote: RelationshipNote = {
        type: "O",
        entities: ["@TestPrincipal"],
        content: "Responded positively to this session's approach",
        confidence: 0.7,
      };
      const deps = makeDeps(entries, {
        analyzeForRelationship: () => [oNote],
      });
      RelationshipMemory.execute(makeInput(), deps);
      expect(deps.capturedNotes).toHaveLength(1);
      expect(deps.capturedNotes[0].type).toBe("O");
      expect(deps.capturedNotes[0].confidence).toBe(0.7);
    });

    test("logs captured count after writing notes", () => {
      const entries: TranscriptEntry[] = [{ type: "user", message: { content: "some content" } }];
      const oNote: RelationshipNote = {
        type: "O",
        entities: ["@TestPrincipal"],
        content: "Responded positively to this session's approach",
        confidence: 0.7,
      };
      const deps = makeDeps(entries, {
        analyzeForRelationship: () => [oNote],
      });
      RelationshipMemory.execute(makeInput(), deps);
      expect(deps.stderrLines.some((l) => l.includes("Captured 1 notes"))).toBe(true);
    });
  });

  describe("execute — with frustration pattern notes (O type)", () => {
    test("writeNotes is called with O-type note for frustrations", () => {
      const entries: TranscriptEntry[] = [{ type: "user", message: { content: "some content" } }];
      const frustrationNote: RelationshipNote = {
        type: "O",
        entities: ["@TestPrincipal"],
        content: "Experienced frustration during this session (likely tooling-related)",
        confidence: 0.75,
      };
      const deps = makeDeps(entries, {
        analyzeForRelationship: () => [frustrationNote],
      });
      RelationshipMemory.execute(makeInput(), deps);
      expect(deps.capturedNotes).toHaveLength(1);
      expect(deps.capturedNotes[0].type).toBe("O");
      expect(deps.capturedNotes[0].content).toContain("frustration");
      expect(deps.capturedNotes[0].confidence).toBe(0.75);
    });
  });

  describe("execute — with SUMMARY entries (B type)", () => {
    test("writeNotes is called with B-type note for summaries", () => {
      const entries: TranscriptEntry[] = [
        { type: "assistant", message: { content: "SUMMARY: Completed refactor of auth module" } },
      ];
      const summaryNote: RelationshipNote = {
        type: "B",
        entities: ["@TestDA"],
        content: "Completed refactor of auth module",
      };
      const deps = makeDeps(entries, {
        analyzeForRelationship: () => [summaryNote],
      });
      RelationshipMemory.execute(makeInput(), deps);
      expect(deps.capturedNotes).toHaveLength(1);
      expect(deps.capturedNotes[0].type).toBe("B");
      expect(deps.capturedNotes[0].content).toContain("Completed refactor");
    });

    test("captures multiple B-type notes from multiple summaries", () => {
      const entries: TranscriptEntry[] = [
        { type: "assistant", message: { content: "SUMMARY: Fixed the database bug" } },
        { type: "assistant", message: { content: "SUMMARY: Deployed to production" } },
      ];
      const notes: RelationshipNote[] = [
        { type: "B", entities: ["@TestDA"], content: "Fixed the database bug" },
        { type: "B", entities: ["@TestDA"], content: "Deployed to production" },
      ];
      const deps = makeDeps(entries, {
        analyzeForRelationship: () => notes,
      });
      RelationshipMemory.execute(makeInput(), deps);
      expect(deps.capturedNotes).toHaveLength(2);
      expect(deps.capturedNotes.every((n) => n.type === "B")).toBe(true);
    });
  });

  describe("execute — defaultAnalyzeForRelationship integration", () => {
    test("produces O note when user text has 2+ positive patterns", () => {
      const entries: TranscriptEntry[] = [
        { type: "user", message: { content: "That is great work you did there" } },
        { type: "user", message: { content: "awesome job, that is perfect output" } },
      ];
      const capturedNotes: RelationshipNote[] = [];
      // Use real defaultDeps.analyzeForRelationship by running through defaultDeps
      const result = RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      expect(result.ok).toBe(true);
      const oNotes = capturedNotes.filter((n) => n.type === "O");
      expect(oNotes.length).toBeGreaterThanOrEqual(1);
      expect(oNotes[0].content).toContain("positively");
    });

    test("produces O note when user text has 2+ frustration patterns", () => {
      const entries: TranscriptEntry[] = [
        { type: "user", message: { content: "This is frustrating me a lot" } },
        { type: "user", message: { content: "I am so frustrated with this behavior" } },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      const oNotes = capturedNotes.filter((n) => n.type === "O");
      expect(oNotes.length).toBeGreaterThanOrEqual(1);
      expect(oNotes[0].content).toContain("frustration");
    });

    test("produces B note from assistant SUMMARY line", () => {
      const entries: TranscriptEntry[] = [
        {
          type: "assistant",
          message: { content: "SUMMARY: Implemented the new caching layer successfully" },
        },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      const bNotes = capturedNotes.filter((n) => n.type === "B");
      expect(bNotes.length).toBeGreaterThanOrEqual(1);
      expect(bNotes[0].content).toContain("Implemented the new caching layer");
    });

    test("produces no notes for short or trivial entries", () => {
      const entries: TranscriptEntry[] = [
        { type: "user", message: { content: "ok" } },
        { type: "assistant", message: { content: "sure" } },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      expect(capturedNotes).toHaveLength(0);
    });
  });

  describe("extractText integration — via defaultAnalyzeForRelationship", () => {
    test("handles string content", () => {
      const entries: TranscriptEntry[] = [
        { type: "user", message: { content: "great work, that was awesome and excellent!" } },
        { type: "user", message: { content: "this is really good job well done nicely done" } },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      // 2 positive matches should produce an O note
      const oNotes = capturedNotes.filter((n) => n.type === "O");
      expect(oNotes.length).toBeGreaterThanOrEqual(1);
    });

    test("handles array content by joining text parts", () => {
      const entries: TranscriptEntry[] = [
        {
          type: "user",
          message: {
            content: [
              { type: "text", text: "That is great and awesome." },
              { type: "image" }, // no text field, should be filtered
            ],
          },
        },
        {
          type: "user",
          message: {
            content: [{ type: "text", text: "Perfect and excellent result here!" }],
          },
        },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      const oNotes = capturedNotes.filter((n) => n.type === "O");
      expect(oNotes.length).toBeGreaterThanOrEqual(1);
    });

    test("handles missing message content gracefully", () => {
      const entries: TranscriptEntry[] = [
        { type: "user" }, // no message
        { type: "assistant", message: { content: "SUMMARY: Handled missing content" } },
      ];
      const capturedNotes: RelationshipNote[] = [];
      expect(() => {
        RelationshipMemory.execute(makeInput(), {
          readTranscript: () => entries,
          analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
          writeNotes: (notes) => capturedNotes.push(...notes),
          stderr: () => {},
        });
      }).not.toThrow();
    });

    test("array content blocks with undefined text field do not crash", () => {
      // Exercises the .map(c => c.text) path where some blocks lack a text field.
      // The filter(c => c.type === "text" && c.text) guards against undefined,
      // so these blocks are excluded and the rest are joined normally.
      const entries: TranscriptEntry[] = [
        {
          type: "user",
          message: {
            content: [
              { type: "text" }, // text field is undefined — should be filtered out
              { type: "text" }, // another undefined text block
              { type: "text", text: "great work, awesome!" }, // valid text block
            ],
          },
        },
        {
          type: "user",
          message: {
            content: [
              { type: "tool_result" }, // non-text type, also no text
              { type: "text", text: "that was excellent and perfect!" },
            ],
          },
        },
      ];
      const capturedNotes: RelationshipNote[] = [];
      expect(() => {
        RelationshipMemory.execute(makeInput(), {
          readTranscript: () => entries,
          analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
          writeNotes: (notes) => capturedNotes.push(...notes),
          stderr: () => {},
        });
      }).not.toThrow();
      // Valid text parts are still joined and matched — two positive hits produce an O note
      const oNotes = capturedNotes.filter((n) => n.type === "O");
      expect(oNotes.length).toBeGreaterThanOrEqual(1);
    });

    test("array content with all undefined text fields returns empty string", () => {
      // All blocks lack text — extractText should return "" and the entry is skipped (< 10 chars)
      const entries: TranscriptEntry[] = [
        {
          type: "user",
          message: {
            content: [
              { type: "image" },
              { type: "tool_result" },
            ],
          },
        },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      // No patterns matched, no notes
      expect(capturedNotes).toHaveLength(0);
    });
  });

  describe("defaultAnalyzeForRelationship — milestone pattern detection", () => {
    test("produces B note when assistant text contains 'first time'", () => {
      const entries: TranscriptEntry[] = [
        {
          type: "assistant",
          message: { content: "This is the first time we have completed this task correctly" },
        },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      const bNotes = capturedNotes.filter((n) => n.type === "B");
      expect(bNotes.length).toBeGreaterThanOrEqual(1);
      expect(bNotes[0].content).toMatch(/first time/i);
    });

    test("produces B note when assistant text contains 'finally'", () => {
      const entries: TranscriptEntry[] = [
        {
          type: "assistant",
          message: { content: "We finally got the authentication system working end to end" },
        },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      const bNotes = capturedNotes.filter((n) => n.type === "B");
      expect(bNotes.length).toBeGreaterThanOrEqual(1);
      expect(bNotes[0].content).toMatch(/finally/i);
    });

    test("produces B note when assistant text contains 'breakthrough'", () => {
      const entries: TranscriptEntry[] = [
        {
          type: "assistant",
          message: { content: "Major breakthrough on the performance bottleneck investigation" },
        },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      const bNotes = capturedNotes.filter((n) => n.type === "B");
      expect(bNotes.length).toBeGreaterThanOrEqual(1);
      expect(bNotes[0].content).toMatch(/breakthrough/i);
    });

    test("produces B note when assistant text contains 'success'", () => {
      const entries: TranscriptEntry[] = [
        {
          type: "assistant",
          message: { content: "The migration was a success and all data transferred cleanly" },
        },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      const bNotes = capturedNotes.filter((n) => n.type === "B");
      expect(bNotes.length).toBeGreaterThanOrEqual(1);
      expect(bNotes[0].content).toMatch(/success/i);
    });

    test("milestone snippet does not include text from adjacent sentences", () => {
      // The regex extracts [^.]*<keyword>[^.]* so it stops at sentence boundaries
      const entries: TranscriptEntry[] = [
        {
          type: "assistant",
          message: {
            content:
              "All tests passed. Finally the CI pipeline is green. We can ship now.",
          },
        },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      const bNotes = capturedNotes.filter((n) => n.type === "B");
      expect(bNotes.length).toBeGreaterThanOrEqual(1);
      // Snippet should not bleed across sentence boundaries
      expect(bNotes[0].content).not.toContain("All tests passed");
      expect(bNotes[0].content).not.toContain("We can ship now");
    });
  });

  describe("defaultAnalyzeForRelationship — preference patterns in user messages", () => {
    test("single preference entry does not crash and produces no O note below threshold", () => {
      // Preference patterns are tracked but do not produce notes directly.
      // A single frustration/positive hit is below the >= 2 threshold.
      const entries: TranscriptEntry[] = [
        { type: "user", message: { content: "I prefer when you explain each step in detail" } },
      ];
      const capturedNotes: RelationshipNote[] = [];
      expect(() => {
        RelationshipMemory.execute(makeInput(), {
          readTranscript: () => entries,
          analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
          writeNotes: (notes) => capturedNotes.push(...notes),
          stderr: () => {},
        });
      }).not.toThrow();
      expect(capturedNotes).toHaveLength(0);
    });

    test("appreciate when phrasing does not crash", () => {
      const entries: TranscriptEntry[] = [
        { type: "user", message: { content: "I appreciate when you ask before making changes" } },
      ];
      const capturedNotes: RelationshipNote[] = [];
      expect(() => {
        RelationshipMemory.execute(makeInput(), {
          readTranscript: () => entries,
          analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
          writeNotes: (notes) => capturedNotes.push(...notes),
          stderr: () => {},
        });
      }).not.toThrow();
    });

    test("like when phrasing does not crash", () => {
      const entries: TranscriptEntry[] = [
        { type: "user", message: { content: "I like when you summarize at the end" } },
      ];
      const capturedNotes: RelationshipNote[] = [];
      expect(() => {
        RelationshipMemory.execute(makeInput(), {
          readTranscript: () => entries,
          analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
          writeNotes: (notes) => capturedNotes.push(...notes),
          stderr: () => {},
        });
      }).not.toThrow();
    });
  });

  describe("defaultAnalyzeForRelationship — summary deduplication", () => {
    test("identical SUMMARY texts produce only one B note", () => {
      // [...new Set(sessionSummary)] deduplicates before slicing
      const entries: TranscriptEntry[] = [
        { type: "assistant", message: { content: "SUMMARY: Refactored the logging module" } },
        { type: "assistant", message: { content: "SUMMARY: Refactored the logging module" } },
        { type: "assistant", message: { content: "SUMMARY: Refactored the logging module" } },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      const bNotes = capturedNotes.filter((n) => n.type === "B");
      expect(bNotes).toHaveLength(1);
      expect(bNotes[0].content).toBe("Refactored the logging module");
    });

    test("two distinct SUMMARY texts each produce a separate B note", () => {
      const entries: TranscriptEntry[] = [
        { type: "assistant", message: { content: "SUMMARY: Wrote unit tests for the parser" } },
        { type: "assistant", message: { content: "SUMMARY: Wrote unit tests for the parser" } },
        { type: "assistant", message: { content: "SUMMARY: Deployed the service to staging" } },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      const bNotes = capturedNotes.filter((n) => n.type === "B");
      expect(bNotes).toHaveLength(2);
      const contents = bNotes.map((n) => n.content);
      expect(contents).toContain("Wrote unit tests for the parser");
      expect(contents).toContain("Deployed the service to staging");
    });
  });

  describe("defaultAnalyzeForRelationship — max 3 B notes from summaries", () => {
    test("more than 3 unique SUMMARY entries produce at most 3 B notes", () => {
      // .slice(0, 3) caps the output at 3 notes
      const entries: TranscriptEntry[] = [
        { type: "assistant", message: { content: "SUMMARY: Completed task alpha successfully" } },
        { type: "assistant", message: { content: "SUMMARY: Completed task beta successfully" } },
        { type: "assistant", message: { content: "SUMMARY: Completed task gamma successfully" } },
        { type: "assistant", message: { content: "SUMMARY: Completed task delta successfully" } },
        { type: "assistant", message: { content: "SUMMARY: Completed task epsilon successfully" } },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      const bNotes = capturedNotes.filter((n) => n.type === "B");
      expect(bNotes.length).toBeLessThanOrEqual(3);
      expect(bNotes.length).toBeGreaterThanOrEqual(1);
    });

    test("exactly 3 unique summaries produce exactly 3 B notes", () => {
      const entries: TranscriptEntry[] = [
        { type: "assistant", message: { content: "SUMMARY: Fixed the cache invalidation bug" } },
        { type: "assistant", message: { content: "SUMMARY: Added retry logic to the API client" } },
        { type: "assistant", message: { content: "SUMMARY: Updated the schema migration script" } },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      const bNotes = capturedNotes.filter((n) => n.type === "B");
      expect(bNotes).toHaveLength(3);
    });

    test("B notes from slice are the first 3 unique summaries in order", () => {
      const entries: TranscriptEntry[] = [
        { type: "assistant", message: { content: "SUMMARY: First unique summary here" } },
        { type: "assistant", message: { content: "SUMMARY: Second unique summary here" } },
        { type: "assistant", message: { content: "SUMMARY: Third unique summary here" } },
        { type: "assistant", message: { content: "SUMMARY: Fourth unique summary here" } },
      ];
      const capturedNotes: RelationshipNote[] = [];
      RelationshipMemory.execute(makeInput(), {
        readTranscript: () => entries,
        analyzeForRelationship: RelationshipMemory.defaultDeps.analyzeForRelationship,
        writeNotes: (notes) => capturedNotes.push(...notes),
        stderr: () => {},
      });
      const bNotes = capturedNotes.filter((n) => n.type === "B");
      expect(bNotes).toHaveLength(3);
      expect(bNotes[0].content).toBe("First unique summary here");
      expect(bNotes[1].content).toBe("Second unique summary here");
      expect(bNotes[2].content).toBe("Third unique summary here");
    });
  });
});

// ─── safeParseTranscriptLine (exported pure function) ───────────────────────

describe("safeParseTranscriptLine", () => {
  test("parses valid user entry", () => {
    const line = JSON.stringify({ type: "user", message: { content: "hello" } });
    const result = safeParseTranscriptLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("user");
  });

  test("parses valid assistant entry", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: "SUMMARY: Done" } });
    const result = safeParseTranscriptLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("assistant");
  });

  test("returns null for empty string", () => {
    expect(safeParseTranscriptLine("")).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(safeParseTranscriptLine("   ")).toBeNull();
  });

  test("returns null for line without opening brace", () => {
    expect(safeParseTranscriptLine("no json here")).toBeNull();
  });

  test("returns null for line without type field", () => {
    expect(safeParseTranscriptLine('{"message": "no type"}')).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(safeParseTranscriptLine("{broken json")).toBeNull();
  });

  test("returns null for type that is not user or assistant", () => {
    const line = JSON.stringify({ type: "system", message: { content: "sys" } });
    expect(safeParseTranscriptLine(line)).toBeNull();
  });

  test("handles prefix text before the JSON object", () => {
    const json = JSON.stringify({ type: "user", message: { content: "test" } });
    const line = `some prefix text ${json}`;
    const result = safeParseTranscriptLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("user");
  });

  test("parses entry with array content blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello world" }] },
    });
    const result = safeParseTranscriptLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("assistant");
  });
});
