import { describe, test, expect } from "bun:test";
import { AgentLifecycleStop } from "./AgentLifecycleStop.contract";
import type { AgentLifecycleDeps, AgentFileData } from "../shared";
import { ok, err } from "@hooks/core/result";
import { fileNotFound, fileWriteFailed } from "@hooks/core/error";
import type { SubagentStopInput } from "@hooks/core/types/hook-inputs";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const AGENTS_DIR = "/tmp/test-agents";
const FIXED_NOW = new Date("2026-03-19T15:10:00.000Z");

const stopInput: SubagentStopInput = {
  session_id: "abc123",
};

function makeDeps(overrides: Partial<AgentLifecycleDeps> = {}): AgentLifecycleDeps {
  return {
    readFile: () => ok("{}"),
    writeFile: () => ok(undefined),
    fileExists: () => false,
    ensureDir: () => ok(undefined),
    readDir: () => ok([]),
    removeFile: () => ok(undefined),
    getAgentsDir: () => AGENTS_DIR,
    stderr: () => {},
    now: () => FIXED_NOW,
    ...overrides,
  };
}

function agentFilePath(sessionId: string): string {
  return `${AGENTS_DIR}/agent-${sessionId}.json`;
}

// ─── AgentLifecycleStop Tests ─────────────────────────────────────────────────

describe("AgentLifecycleStop", () => {
  describe("contract metadata", () => {
    test("name is AgentLifecycleStop", () => {
      expect(AgentLifecycleStop.name).toBe("AgentLifecycleStop");
    });

    test("event is SubagentStop", () => {
      expect(AgentLifecycleStop.event).toBe("SubagentStop");
    });
  });

  describe("accepts", () => {
    test("accepts all SubagentStop inputs", () => {
      expect(AgentLifecycleStop.accepts(stopInput)).toBe(true);
    });

    test("accepts input with empty session_id", () => {
      expect(AgentLifecycleStop.accepts({ session_id: "" })).toBe(true);
    });
  });

  describe("execute — happy path (file exists)", () => {
    test("returns ok with silent type", () => {
      const existingData: AgentFileData = {
        agentId: "abc123",
        agentType: "unknown",
        startedAt: "2026-03-19T15:00:00.000Z",
        completedAt: null,
      };
      const deps = makeDeps({
        fileExists: (path) => path === agentFilePath("abc123"),
        readFile: () => ok(JSON.stringify(existingData)),
      });
      const result = AgentLifecycleStop.execute(stopInput, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe("silent");
    });

    test("reads existing agent file", () => {
      const readPaths: string[] = [];
      const existingData: AgentFileData = {
        agentId: "abc123",
        agentType: "unknown",
        startedAt: "2026-03-19T15:00:00.000Z",
        completedAt: null,
      };
      const deps = makeDeps({
        fileExists: () => true,
        readFile: (path) => {
          readPaths.push(path);
          return ok(JSON.stringify(existingData));
        },
      });
      AgentLifecycleStop.execute(stopInput, deps);
      expect(readPaths).toContain(agentFilePath("abc123"));
    });

    test("sets completedAt to current time", () => {
      const existingData: AgentFileData = {
        agentId: "abc123",
        agentType: "unknown",
        startedAt: "2026-03-19T15:00:00.000Z",
        completedAt: null,
      };
      let writtenData: AgentFileData | null = null;
      const deps = makeDeps({
        fileExists: () => true,
        readFile: () => ok(JSON.stringify(existingData)),
        writeFile: (_path, content) => {
          writtenData = JSON.parse(content) as AgentFileData;
          return ok(undefined);
        },
      });
      AgentLifecycleStop.execute(stopInput, deps);
      expect(writtenData).not.toBeNull();
      expect(writtenData!.completedAt).toBe("2026-03-19T15:10:00.000Z");
      expect(writtenData!.startedAt).toBe("2026-03-19T15:00:00.000Z");
    });

    test("preserves original agentId and agentType", () => {
      const existingData: AgentFileData = {
        agentId: "abc123",
        agentType: "unknown",
        startedAt: "2026-03-19T15:00:00.000Z",
        completedAt: null,
      };
      let writtenData: AgentFileData | null = null;
      const deps = makeDeps({
        fileExists: () => true,
        readFile: () => ok(JSON.stringify(existingData)),
        writeFile: (_path, content) => {
          writtenData = JSON.parse(content) as AgentFileData;
          return ok(undefined);
        },
      });
      AgentLifecycleStop.execute(stopInput, deps);
      expect(writtenData!.agentId).toBe("abc123");
      expect(writtenData!.agentType).toBe("unknown");
    });
  });

  describe("execute — crash recovery (corrupt file)", () => {
    test("recovers from corrupt JSON in agent file", () => {
      let writtenData: AgentFileData | null = null;
      const deps = makeDeps({
        fileExists: () => true,
        readFile: () => ok("not-valid-json{{{"),
        writeFile: (_path, content) => {
          writtenData = JSON.parse(content) as AgentFileData;
          return ok(undefined);
        },
      });
      const result = AgentLifecycleStop.execute(stopInput, deps);
      expect(result.ok).toBe(true);
      expect(writtenData).not.toBeNull();
      expect(writtenData!.agentId).toBe("abc123");
      expect(writtenData!.completedAt).toBe("2026-03-19T15:10:00.000Z");
      expect(writtenData!.startedAt).toBe("2026-03-19T15:10:00.000Z");
    });

    test("logs corrupt file recovery message", () => {
      const messages: string[] = [];
      const deps = makeDeps({
        fileExists: () => true,
        readFile: () => ok("corrupt"),
        stderr: (msg) => messages.push(msg),
      });
      AgentLifecycleStop.execute(stopInput, deps);
      expect(messages.some((m) => m.includes("corrupt"))).toBe(true);
    });
  });

  describe("execute — crash recovery (file missing)", () => {
    test("creates agent file when not found", () => {
      const writtenPaths: string[] = [];
      const deps = makeDeps({
        fileExists: () => false,
        writeFile: (path, _content) => {
          writtenPaths.push(path);
          return ok(undefined);
        },
      });
      AgentLifecycleStop.execute(stopInput, deps);
      expect(writtenPaths).toContain(agentFilePath("abc123"));
    });

    test("sets startedAt and completedAt to now when file missing", () => {
      let writtenData: AgentFileData | null = null;
      const deps = makeDeps({
        fileExists: () => false,
        writeFile: (_path, content) => {
          writtenData = JSON.parse(content) as AgentFileData;
          return ok(undefined);
        },
      });
      AgentLifecycleStop.execute(stopInput, deps);
      expect(writtenData).not.toBeNull();
      expect(writtenData!.startedAt).toBe("2026-03-19T15:10:00.000Z");
      expect(writtenData!.completedAt).toBe("2026-03-19T15:10:00.000Z");
    });

    test("logs crash recovery message", () => {
      const messages: string[] = [];
      const deps = makeDeps({
        fileExists: () => false,
        stderr: (msg) => messages.push(msg),
      });
      AgentLifecycleStop.execute(stopInput, deps);
      expect(messages.some((m) => m.includes("crash") || m.includes("recovery") || m.includes("missing"))).toBe(true);
    });
  });

  describe("execute — orphan cleanup", () => {
    test("cleans up agent files older than 30 minutes with no completedAt", () => {
      const removedPaths: string[] = [];
      const orphanData: AgentFileData = {
        agentId: "old-orphan",
        agentType: "unknown",
        startedAt: "2026-03-19T14:30:00.000Z", // 40 min ago from FIXED_NOW
        completedAt: null,
      };
      const currentData: AgentFileData = {
        agentId: "abc123",
        agentType: "unknown",
        startedAt: "2026-03-19T15:00:00.000Z",
        completedAt: null,
      };
      const deps = makeDeps({
        fileExists: (path) => path === agentFilePath("abc123"),
        readDir: () => ok(["agent-abc123.json", "agent-old-orphan.json"]),
        readFile: (path) => {
          if (path.includes("old-orphan")) return ok(JSON.stringify(orphanData));
          if (path.includes("abc123")) return ok(JSON.stringify(currentData));
          return err(fileNotFound(path));
        },
        removeFile: (path) => {
          removedPaths.push(path);
          return ok(undefined);
        },
      });
      AgentLifecycleStop.execute(stopInput, deps);
      expect(removedPaths.some((p) => p.includes("old-orphan"))).toBe(true);
    });

    test("does not clean up completed agent files", () => {
      const removedPaths: string[] = [];
      const completedData: AgentFileData = {
        agentId: "completed-agent",
        agentType: "unknown",
        startedAt: "2026-03-19T14:30:00.000Z", // 40 min ago
        completedAt: "2026-03-19T14:35:00.000Z",
      };
      const currentData: AgentFileData = {
        agentId: "abc123",
        agentType: "unknown",
        startedAt: "2026-03-19T15:00:00.000Z",
        completedAt: null,
      };
      const deps = makeDeps({
        fileExists: (path) => path === agentFilePath("abc123"),
        readDir: () => ok(["agent-abc123.json", "agent-completed-agent.json"]),
        readFile: (path) => {
          if (path.includes("completed-agent")) return ok(JSON.stringify(completedData));
          if (path.includes("abc123")) return ok(JSON.stringify(currentData));
          return err(fileNotFound(path));
        },
        removeFile: (path) => {
          removedPaths.push(path);
          return ok(undefined);
        },
      });
      AgentLifecycleStop.execute(stopInput, deps);
      expect(removedPaths.some((p) => p.includes("completed-agent"))).toBe(false);
    });

    test("does not clean up recent agent files without completedAt", () => {
      const removedPaths: string[] = [];
      const recentData: AgentFileData = {
        agentId: "recent-agent",
        agentType: "unknown",
        startedAt: "2026-03-19T15:05:00.000Z", // 5 min ago — within 30 min threshold
        completedAt: null,
      };
      const currentData: AgentFileData = {
        agentId: "abc123",
        agentType: "unknown",
        startedAt: "2026-03-19T15:00:00.000Z",
        completedAt: null,
      };
      const deps = makeDeps({
        fileExists: (path) => path === agentFilePath("abc123"),
        readDir: () => ok(["agent-abc123.json", "agent-recent-agent.json"]),
        readFile: (path) => {
          if (path.includes("recent-agent")) return ok(JSON.stringify(recentData));
          if (path.includes("abc123")) return ok(JSON.stringify(currentData));
          return err(fileNotFound(path));
        },
        removeFile: (path) => {
          removedPaths.push(path);
          return ok(undefined);
        },
      });
      AgentLifecycleStop.execute(stopInput, deps);
      expect(removedPaths.some((p) => p.includes("recent-agent"))).toBe(false);
    });

    test("does not remove the current agent's own file during cleanup", () => {
      const removedPaths: string[] = [];
      const deps = makeDeps({
        fileExists: () => false,
        readDir: () => ok(["agent-abc123.json"]),
        readFile: () =>
          ok(
            JSON.stringify({
              agentId: "abc123",
              agentType: "unknown",
              startedAt: "2026-03-19T14:30:00.000Z",
              completedAt: null,
            }),
          ),
        removeFile: (path) => {
          removedPaths.push(path);
          return ok(undefined);
        },
      });
      AgentLifecycleStop.execute(stopInput, deps);
      expect(removedPaths.some((p) => p.includes("abc123"))).toBe(false);
    });

    test("cleanup failures are silently ignored", () => {
      const orphanData: AgentFileData = {
        agentId: "old-orphan",
        agentType: "unknown",
        startedAt: "2026-03-19T14:30:00.000Z",
        completedAt: null,
      };
      const deps = makeDeps({
        fileExists: () => false,
        readDir: () => ok(["agent-old-orphan.json"]),
        readFile: (path) => {
          if (path.includes("old-orphan")) return ok(JSON.stringify(orphanData));
          return err(fileNotFound(path));
        },
        removeFile: () => err(fileWriteFailed("agent.json", new Error("permission denied"))),
      });
      const result = AgentLifecycleStop.execute(stopInput, deps);
      expect(result.ok).toBe(true);
    });

    test("cleanup continues when readDir fails", () => {
      const deps = makeDeps({
        fileExists: () => false,
        readDir: () => err(fileNotFound(AGENTS_DIR)),
      });
      const result = AgentLifecycleStop.execute(stopInput, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe("silent");
    });

    test("skips non-agent files during cleanup", () => {
      const readPaths: string[] = [];
      const deps = makeDeps({
        fileExists: () => false,
        readDir: () => ok(["agent-abc123.json", "not-an-agent.txt", ".DS_Store"]),
        readFile: (path) => {
          readPaths.push(path);
          return ok(
            JSON.stringify({
              agentId: "abc123",
              agentType: "unknown",
              startedAt: "2026-03-19T14:30:00.000Z",
              completedAt: null,
            }),
          );
        },
      });
      AgentLifecycleStop.execute(stopInput, deps);
      expect(readPaths.every((p) => p.includes("agent-"))).toBe(true);
    });
  });

  describe("execute — error handling", () => {
    test("returns ok silent when readFile fails on existing file", () => {
      const deps = makeDeps({
        fileExists: () => true,
        readFile: () => err(fileNotFound("agent.json")),
      });
      const result = AgentLifecycleStop.execute(stopInput, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe("silent");
    });

    test("returns ok silent when writeFile fails", () => {
      const deps = makeDeps({
        fileExists: () => false,
        writeFile: () => err(fileWriteFailed("agent.json", new Error("disk full"))),
      });
      const result = AgentLifecycleStop.execute(stopInput, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe("silent");
    });
  });
});
