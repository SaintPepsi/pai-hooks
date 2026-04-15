import { describe, expect, it } from "bun:test";
import { dirCreateFailed } from "@hooks/core/error";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import {
  buildAgentPrompt,
  evaluateCredit,
  LearningActioner,
  type LearningActionerDeps,
} from "./LearningActioner.contract";

// Default readJson returns credit of 9.5 (just under threshold of 10)
// and 0% utilization, so a single session pushes credit to 10.5 and triggers spawn.
function makeDeps(overrides: Partial<LearningActionerDeps> = {}): LearningActionerDeps {
  return {
    ...LearningActioner.defaultDeps,
    fileExists: () => false,
    readDir: () => ({ ok: true, value: [] }),
    readJson: ((path: string) => {
      if (path.includes("learning-agent-credit.json")) {
        return {
          ok: true,
          value: { credit: 9.5, last_updated: "2026-01-01T00:00:00Z" },
        };
      }
      if (path.includes("usage-cache.json")) {
        return {
          ok: true,
          value: { five_hour: { utilization: 0, resets_at: "" } },
        };
      }
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: "not found", context: {} },
      } as unknown as ReturnType<LearningActionerDeps["readJson"]>;
    }) as unknown as LearningActionerDeps["readJson"],
    ensureDir: () => ({ ok: true, value: undefined }),
    writeFile: () => ({ ok: true, value: undefined }),
    removeFile: () => ({ ok: true, value: undefined }),
    stat: () => ({ ok: true, value: { mtimeMs: Date.now() } }),
    runLearningAgent: () => ({ ok: true, value: undefined }),
    getISOTimestamp: () => "2026-02-27T16:30:00+11:00",
    baseDir: "/tmp/test-pai",
    stderr: () => {},
    ...overrides,
  };
}

function makeInput(overrides: Partial<SessionEndInput> = {}): SessionEndInput {
  return {
    session_id: "test-session-123",
    ...overrides,
  };
}

describe("LearningActioner contract", () => {
  it("has correct name and event", () => {
    expect(LearningActioner.name).toBe("LearningActioner");
    expect(LearningActioner.event).toBe("SessionEnd");
  });

  it("always accepts SessionEnd events", () => {
    expect(LearningActioner.accepts(makeInput())).toBe(true);
  });

  it("returns silent when no learning sources exist", () => {
    const deps = makeDeps({ fileExists: () => false });
    const result = LearningActioner.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({});
  });

  it("returns silent when .analyzing lock file exists and is fresh", () => {
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith(".analyzing"),
      stat: () => ({ ok: true, value: { mtimeMs: Date.now() - 1000 } }),
    });
    const result = LearningActioner.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({});
  });

  it("cleans up stale .analyzing lock file (>45 min old)", () => {
    let removedPath = "";
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.endsWith(".analyzing")) return true;
        if (path.endsWith("algorithm-reflections.jsonl")) return true;
        return false;
      },
      stat: (path: string) => {
        if (path.endsWith(".analyzing")) {
          return { ok: true, value: { mtimeMs: Date.now() - 46 * 60 * 1000 } };
        }
        return { ok: true, value: { mtimeMs: Date.now() } };
      },
      removeFile: (path: string) => {
        removedPath = path;
        return { ok: true, value: undefined };
      },
    });
    LearningActioner.execute(makeInput(), deps);
    expect(removedPath).toContain(".analyzing");
  });

  it("calls runLearningAgent when conditions met", () => {
    let called = false;
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("algorithm-reflections.jsonl"),
      runLearningAgent: () => {
        called = true;
        return { ok: true, value: undefined };
      },
    });
    LearningActioner.execute(makeInput(), deps);
    expect(called).toBe(true);
  });

  it("returns silent when credit is below threshold", () => {
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("algorithm-reflections.jsonl"),
      readJson: ((path: string) => {
        if (path.includes("learning-agent-credit.json")) {
          return {
            ok: true,
            value: { credit: 3.0, last_updated: "2026-01-01T00:00:00Z" },
          };
        }
        if (path.includes("usage-cache.json")) {
          return {
            ok: true,
            value: { five_hour: { utilization: 0, resets_at: "" } },
          };
        }
        return {
          ok: false,
          error: { code: "NOT_FOUND", message: "not found", context: {} },
        } as unknown as ReturnType<LearningActionerDeps["readJson"]>;
      }) as unknown as LearningActionerDeps["readJson"],
    });
    const result = LearningActioner.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({});
  });

  it("spawns when credit crosses threshold of 10", () => {
    let spawned = false;
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("algorithm-reflections.jsonl"),
      readJson: ((path: string) => {
        if (path.includes("learning-agent-credit.json")) {
          return {
            ok: true,
            value: { credit: 9.5, last_updated: "2026-01-01T00:00:00Z" },
          };
        }
        if (path.includes("usage-cache.json")) {
          return {
            ok: true,
            value: { five_hour: { utilization: 0, resets_at: "" } },
          };
        }
        return {
          ok: false,
          error: { code: "NOT_FOUND", message: "not found", context: {} },
        } as unknown as ReturnType<LearningActionerDeps["readJson"]>;
      }) as unknown as LearningActionerDeps["readJson"],
      runLearningAgent: () => {
        spawned = true;
        return { ok: true, value: undefined };
      },
    });
    LearningActioner.execute(makeInput(), deps);
    expect(spawned).toBe(true);
  });

  it("returns silent when projected 5h usage >= 100%", () => {
    let spawned = false;
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("algorithm-reflections.jsonl"),
      readJson: ((path: string) => {
        if (path.includes("learning-agent-credit.json")) {
          return {
            ok: true,
            value: { credit: 9.99, last_updated: "2026-01-01T00:00:00Z" },
          };
        }
        if (path.includes("usage-cache.json")) {
          // 80% with 4h remaining (1h elapsed) → projected 400%
          return {
            ok: true,
            value: {
              five_hour: {
                utilization: 80,
                resets_at: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
              },
            },
          };
        }
        return {
          ok: false,
          error: { code: "NOT_FOUND", message: "not found", context: {} },
        } as unknown as ReturnType<LearningActionerDeps["readJson"]>;
      }) as unknown as LearningActionerDeps["readJson"],
      runLearningAgent: () => {
        spawned = true;
        return { ok: true, value: undefined };
      },
    });
    LearningActioner.execute(makeInput(), deps);
    expect(spawned).toBe(false);
  });

  it("returns silent without spawning when ensureDir fails", () => {
    let spawned = false;
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("algorithm-reflections.jsonl"),
      ensureDir: () => ({
        ok: false,
        error: dirCreateFailed(
          "/tmp/test-pai/MEMORY/LEARNING/PROPOSALS/pending",
          new Error("permission denied"),
        ),
      }),
      runLearningAgent: () => {
        spawned = true;
        return { ok: true, value: undefined };
      },
    });
    const result = LearningActioner.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({});
    expect(spawned).toBe(false);
  });

  it("finds learning sources from directories when files absent", () => {
    let spawned = false;
    const deps = makeDeps({
      fileExists: (path: string) => {
        // No individual source files, but ALGORITHM dir exists
        if (path.endsWith("ALGORITHM")) return true;
        return false;
      },
      readDir: (path: string) => {
        if (path.includes("ALGORITHM")) {
          return { ok: true, value: [{ name: "learning.md" }] };
        }
        return { ok: true, value: [] };
      },
      runLearningAgent: () => {
        spawned = true;
        return { ok: true, value: undefined };
      },
    });
    LearningActioner.execute(makeInput(), deps);
    expect(spawned).toBe(true);
  });

  it("skips directories with no files", () => {
    const stderrLines: string[] = [];
    const deps = makeDeps({
      fileExists: (path: string) => {
        // Directory exists but no source files
        if (path.endsWith("ALGORITHM") || path.endsWith("SYSTEM") || path.endsWith("QUALITY"))
          return true;
        return false;
      },
      readDir: () => ({ ok: true, value: [] }),
      stderr: (msg: string) => stderrLines.push(msg),
    });
    LearningActioner.execute(makeInput(), deps);
    expect(stderrLines.some((l) => l.includes("No learning sources found"))).toBe(true);
  });

  it("logs stale lock removal failure", () => {
    const stderrLines: string[] = [];
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.endsWith(".analyzing")) return true;
        if (path.endsWith("algorithm-reflections.jsonl")) return true;
        return false;
      },
      stat: (path: string) => {
        if (path.endsWith(".analyzing")) {
          return { ok: true, value: { mtimeMs: Date.now() - 46 * 60 * 1000 } };
        }
        return { ok: true, value: { mtimeMs: Date.now() } };
      },
      removeFile: () => ({
        ok: false,
        error: dirCreateFailed("/tmp/.analyzing", new Error("permission denied")),
      }),
      stderr: (msg: string) => stderrLines.push(msg),
    });
    LearningActioner.execute(makeInput(), deps);
    expect(stderrLines.some((l) => l.includes("Failed to remove stale lock"))).toBe(true);
  });

  it("handles stat failure in isTimestampFresh (lock treated as not fresh)", () => {
    let spawned = false;
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.endsWith(".analyzing")) return true;
        if (path.endsWith("algorithm-reflections.jsonl")) return true;
        return false;
      },
      stat: () => ({
        ok: false,
        error: dirCreateFailed("/tmp", new Error("no stat")),
      }),
      removeFile: () => ({ ok: true, value: undefined }),
      runLearningAgent: () => {
        spawned = true;
        return { ok: true, value: undefined };
      },
    });
    LearningActioner.execute(makeInput(), deps);
    // stat fails => isTimestampFresh returns false => stale lock => cleaned up => proceeds
    expect(spawned).toBe(true);
  });
});

describe("buildAgentPrompt", () => {
  it("returns a string containing the baseDir", () => {
    const prompt = buildAgentPrompt("/home/test/.claude");
    expect(prompt).toContain("/home/test/.claude");
  });

  it("interpolates baseDir in working directory and proposals path", () => {
    const prompt = buildAgentPrompt("/Users/ian/.claude");
    expect(prompt).toContain("WORKING DIRECTORY: /Users/ian/.claude");
    expect(prompt).toContain(
      "Write proposals to: /Users/ian/.claude/MEMORY/LEARNING/PROPOSALS/pending/",
    );
  });

  it("mentions learning source paths", () => {
    const prompt = buildAgentPrompt("/tmp/pai");
    expect(prompt).toContain("algorithm-reflections.jsonl");
    expect(prompt).toContain("quality-violations.jsonl");
  });

  it("mentions proposals directories", () => {
    const prompt = buildAgentPrompt("/tmp/pai");
    expect(prompt).toContain("PROPOSALS/pending/");
    expect(prompt).toContain("PROPOSALS/applied/");
    expect(prompt).toContain("PROPOSALS/rejected/");
  });

  it("includes proposal file format instructions", () => {
    const prompt = buildAgentPrompt("/tmp/pai");
    expect(prompt).toContain("status: pending");
    expect(prompt).toContain("category:");
  });

  it("includes valid proposal categories", () => {
    const prompt = buildAgentPrompt("/tmp/pai");
    expect(prompt).toContain("steering-rule");
    expect(prompt).toContain("memory");
    expect(prompt).toContain("hook");
    expect(prompt).toContain("skill");
    expect(prompt).toContain("workflow");
    expect(prompt).toContain("token-efficiency");
  });

  it("includes all 5 sections", () => {
    const prompt = buildAgentPrompt("/tmp/pai");
    expect(prompt).toContain("SECTION 1: LEARNING SOURCES");
    expect(prompt).toContain("SECTION 2: SYSTEM STATE");
    expect(prompt).toContain("SECTION 3: FEEDBACK CORPUS");
    expect(prompt).toContain("SECTION 4: RECENT WORK CONTEXT");
    expect(prompt).toContain("SECTION 5: PROPOSAL FORMAT");
  });

  it("includes confidence scoring template", () => {
    const prompt = buildAgentPrompt("/tmp/pai");
    expect(prompt).toContain("agent_score:");
    expect(prompt).toContain("agent_reasoning:");
    expect(prompt).toContain("similar_to_applied:");
    expect(prompt).toContain("differs_from_rejected:");
  });

  it("includes system state awareness instructions", () => {
    const prompt = buildAgentPrompt("/tmp/pai");
    expect(prompt).toContain("CLAUDE.md");
    expect(prompt).toContain("AISTEERINGRULES.md");
    expect(prompt).toContain("skill-index.json");
  });

  it("includes feedback corpus instructions with context budget", () => {
    const prompt = buildAgentPrompt("/tmp/pai");
    expect(prompt).toContain("Read at most 10 most recent proposals");
    expect(prompt).toContain("Backfilled");
    expect(prompt).toContain("decision_rationale");
  });

  it("includes git diff instruction for applied proposals", () => {
    const prompt = buildAgentPrompt("/tmp/pai");
    expect(prompt).toContain("git log --oneline");
  });
});

describe("evaluateCredit", () => {
  function makeCreditDeps(
    opts: {
      credit?: number;
      creditMissing?: boolean;
      utilization?: number;
      resetsAt?: string;
      usageMissing?: boolean;
    } = {},
  ): LearningActionerDeps {
    const notFound = {
      ok: false,
      error: { code: "NOT_FOUND", message: "not found", context: {} },
    } as unknown as ReturnType<LearningActionerDeps["readJson"]>;
    return makeDeps({
      readJson: ((path: string) => {
        if (path.includes("learning-agent-credit.json")) {
          if (opts.creditMissing) return notFound;
          return {
            ok: true,
            value: {
              credit: opts.credit ?? 0,
              last_updated: "2026-01-01T00:00:00Z",
            },
          };
        }
        if (path.includes("usage-cache.json")) {
          if (opts.usageMissing) return notFound;
          return {
            ok: true,
            value: {
              five_hour: {
                utilization: opts.utilization ?? 0,
                resets_at: opts.resetsAt ?? "",
              },
            },
          };
        }
        return notFound;
      }) as unknown as LearningActionerDeps["readJson"],
    });
  }

  it("accumulates credit proportional to remaining headroom", () => {
    const result = evaluateCredit("/tmp/test", makeCreditDeps({ utilization: 50, credit: 0 }));
    expect(result.newCredit).toBeCloseTo(0.5);
    expect(result.shouldSpawn).toBe(false);
  });

  it("spawns when credit crosses threshold of 10", () => {
    const result = evaluateCredit("/tmp/test", makeCreditDeps({ utilization: 5, credit: 9.5 }));
    expect(result.shouldSpawn).toBe(true);
    expect(result.newCredit).toBe(0); // Reset after spawn
  });

  it("hard blocks when projected 5h usage >= 100%", () => {
    const result = evaluateCredit(
      "/tmp/test",
      makeCreditDeps({
        utilization: 80,
        resetsAt: new Date(Date.now() + 4 * 3600 * 1000).toISOString(), // 4h remaining = 1h elapsed
        credit: 9.99,
      }),
    );
    expect(result.shouldSpawn).toBe(false);
    expect(result.newCredit).toBe(-1); // Blocked, no accumulation
  });

  it("does not accumulate credit when projection blocks", () => {
    const result = evaluateCredit(
      "/tmp/test",
      makeCreditDeps({
        utilization: 95,
        resetsAt: new Date(Date.now() + 4.5 * 3600 * 1000).toISOString(),
        credit: 5.0,
      }),
    );
    expect(result.newCredit).toBe(-1);
  });

  it("falls back to 0% utilization when usage-cache.json missing", () => {
    const result = evaluateCredit("/tmp/test", makeCreditDeps({ usageMissing: true, credit: 0 }));
    expect(result.newCredit).toBeCloseTo(1.0);
  });

  it("falls back to 0 credit when credit file missing", () => {
    const result = evaluateCredit(
      "/tmp/test",
      makeCreditDeps({ utilization: 50, creditMissing: true }),
    );
    expect(result.newCredit).toBeCloseTo(0.5);
  });

  it("resets credit to 0 on spawn", () => {
    const result = evaluateCredit("/tmp/test", makeCreditDeps({ credit: 9.8, utilization: 0 }));
    expect(result.shouldSpawn).toBe(true);
    expect(result.newCredit).toBe(0);
  });

  it("logs stderr when usage-cache.json read fails", () => {
    const stderrCalls: string[] = [];
    const deps = { ...makeCreditDeps({ usageMissing: true, credit: 0 }), stderr: (msg: string) => stderrCalls.push(msg) };
    evaluateCredit("/tmp/test", deps);
    expect(stderrCalls.length).toBe(1);
    expect(stderrCalls[0]).toContain("usage-cache.json read failed");
  });

  it("logs stderr when learning-agent-credit.json read fails", () => {
    const stderrCalls: string[] = [];
    const deps = { ...makeCreditDeps({ utilization: 50, creditMissing: true }), stderr: (msg: string) => stderrCalls.push(msg) };
    evaluateCredit("/tmp/test", deps);
    expect(stderrCalls.length).toBe(1);
    expect(stderrCalls[0]).toContain("learning-agent-credit.json read failed");
  });

  it("does not call stderr when both reads succeed", () => {
    const stderrCalls: string[] = [];
    const deps = { ...makeCreditDeps({ utilization: 50, credit: 3.0 }), stderr: (msg: string) => stderrCalls.push(msg) };
    evaluateCredit("/tmp/test", deps);
    expect(stderrCalls.length).toBe(0);
  });
});

describe("LearningActioner defaultDeps", () => {
  it("defaultDeps.fileExists returns a boolean", () => {
    expect(typeof LearningActioner.defaultDeps.fileExists("/tmp")).toBe("boolean");
  });

  it("defaultDeps.readDir returns a Result", () => {
    const result = LearningActioner.defaultDeps.readDir("/tmp", {
      withFileTypes: true,
    });
    expect(typeof result.ok).toBe("boolean");
  });

  it("defaultDeps.writeFile returns a Result", () => {
    const tmpPath = `/tmp/pai-test-la-${Date.now()}.txt`;
    const result = LearningActioner.defaultDeps.writeFile(tmpPath, "test");
    expect(typeof result.ok).toBe("boolean");
  });

  it("defaultDeps.removeFile returns a Result", () => {
    const result = LearningActioner.defaultDeps.removeFile("/tmp/nonexistent-pai-la-12345.txt");
    expect(typeof result.ok).toBe("boolean");
  });

  it("defaultDeps.ensureDir returns a Result", () => {
    const result = LearningActioner.defaultDeps.ensureDir("/tmp");
    expect(typeof result.ok).toBe("boolean");
  });

  it("defaultDeps.stat returns a Result", () => {
    const result = LearningActioner.defaultDeps.stat("/tmp");
    expect(typeof result.ok).toBe("boolean");
  });

  it("defaultDeps.runLearningAgent is a function", () => {
    expect(typeof LearningActioner.defaultDeps.runLearningAgent).toBe("function");
  });

  it("defaultDeps.getISOTimestamp returns a string", () => {
    expect(typeof LearningActioner.defaultDeps.getISOTimestamp()).toBe("string");
  });

  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => LearningActioner.defaultDeps.stderr("test")).not.toThrow();
  });
});
