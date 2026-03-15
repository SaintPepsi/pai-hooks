import { describe, test, expect } from "bun:test";
import { RelationshipMemory, type RelationshipMemoryDeps } from "@hooks/contracts/RelationshipMemory";
import type { StopInput } from "@hooks/core/types/hook-inputs";

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
    analyzeForRelationship: (e: TranscriptEntry[]) => {
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
      const entries: TranscriptEntry[] = [
        { type: "user", message: { content: "Hello there" } },
      ];
      const deps = makeDeps(entries);
      const result = RelationshipMemory.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("silent");
      }
    });

    test("does not call writeNotes when no notes extracted", () => {
      const entries: TranscriptEntry[] = [
        { type: "user", message: { content: "Hello there" } },
      ];
      const deps = makeDeps(entries);
      RelationshipMemory.execute(makeInput(), deps);
      expect(deps.capturedNotes).toHaveLength(0);
    });
  });

  describe("execute — with positive pattern notes (O type)", () => {
    test("writeNotes is called with O-type note for positives", () => {
      const entries: TranscriptEntry[] = [
        { type: "user", message: { content: "some content" } },
      ];
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
      const entries: TranscriptEntry[] = [
        { type: "user", message: { content: "some content" } },
      ];
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
      const entries: TranscriptEntry[] = [
        { type: "user", message: { content: "some content" } },
      ];
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
            content: [
              { type: "text", text: "Perfect and excellent result here!" },
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
  });
});
