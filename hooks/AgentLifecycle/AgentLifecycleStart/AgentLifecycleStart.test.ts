import { describe, test, expect } from "bun:test";
import { AgentLifecycleStart } from "./AgentLifecycleStart.contract";
import type { AgentLifecycleDeps, AgentFileData } from "../shared";
import { ok, err } from "@hooks/core/result";
import { fileWriteFailed } from "@hooks/core/error";
import type { SubagentStartInput } from "@hooks/core/types/hook-inputs";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const AGENTS_DIR = "/tmp/test-agents";
const FIXED_NOW = new Date("2026-03-19T15:10:00.000Z");

const startInput: SubagentStartInput = {
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

// ─── AgentLifecycleStart Tests ────────────────────────────────────────────────

describe("AgentLifecycleStart", () => {
  describe("contract metadata", () => {
    test("name is AgentLifecycleStart", () => {
      expect(AgentLifecycleStart.name).toBe("AgentLifecycleStart");
    });

    test("event is SubagentStart", () => {
      expect(AgentLifecycleStart.event).toBe("SubagentStart");
    });
  });

  describe("accepts", () => {
    test("accepts all SubagentStart inputs", () => {
      expect(AgentLifecycleStart.accepts(startInput)).toBe(true);
    });

    test("accepts input with empty session_id", () => {
      expect(AgentLifecycleStart.accepts({ session_id: "" })).toBe(true);
    });

    test("accepts input with transcript_path", () => {
      expect(
        AgentLifecycleStart.accepts({
          session_id: "x",
          transcript_path: "/some/path",
        }),
      ).toBe(true);
    });
  });

  describe("execute — happy path", () => {
    test("returns ok with silent type", () => {
      const deps = makeDeps();
      const result = AgentLifecycleStart.execute(startInput, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe("silent");
    });

    test("ensures agents directory exists", () => {
      const ensuredDirs: string[] = [];
      const deps = makeDeps({
        ensureDir: (path) => {
          ensuredDirs.push(path);
          return ok(undefined);
        },
      });
      AgentLifecycleStart.execute(startInput, deps);
      expect(ensuredDirs).toContain(AGENTS_DIR);
    });

    test("writes agent file with correct path", () => {
      const writtenPaths: string[] = [];
      const deps = makeDeps({
        writeFile: (path, _content) => {
          writtenPaths.push(path);
          return ok(undefined);
        },
      });
      AgentLifecycleStart.execute(startInput, deps);
      expect(writtenPaths).toContain(agentFilePath("abc123"));
    });

    test("writes agent file with correct data structure", () => {
      let writtenData: AgentFileData | null = null;
      const deps = makeDeps({
        writeFile: (_path, content) => {
          writtenData = JSON.parse(content) as AgentFileData;
          return ok(undefined);
        },
      });
      AgentLifecycleStart.execute(startInput, deps);
      expect(writtenData).not.toBeNull();
      expect(writtenData!.agentId).toBe("abc123");
      expect(writtenData!.agentType).toBe("unknown");
      expect(writtenData!.startedAt).toBe("2026-03-19T15:10:00.000Z");
      expect(writtenData!.completedAt).toBeNull();
    });

    test("logs start message to stderr", () => {
      const messages: string[] = [];
      const deps = makeDeps({
        stderr: (msg) => messages.push(msg),
      });
      AgentLifecycleStart.execute(startInput, deps);
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages.some((m) => m.includes("AgentLifecycle") && m.includes("Start"))).toBe(true);
    });
  });

  describe("execute — error handling", () => {
    test("returns ok silent even when ensureDir fails", () => {
      const deps = makeDeps({
        ensureDir: () => err(fileWriteFailed(AGENTS_DIR, new Error("permission denied"))),
      });
      const result = AgentLifecycleStart.execute(startInput, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe("silent");
    });

    test("returns ok silent even when writeFile fails", () => {
      const deps = makeDeps({
        writeFile: () => err(fileWriteFailed("agent.json", new Error("disk full"))),
      });
      const result = AgentLifecycleStart.execute(startInput, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe("silent");
    });

    test("logs error when writeFile fails", () => {
      const messages: string[] = [];
      const deps = makeDeps({
        writeFile: () => err(fileWriteFailed("agent.json", new Error("disk full"))),
        stderr: (msg) => messages.push(msg),
      });
      AgentLifecycleStart.execute(startInput, deps);
      expect(messages.some((m) => m.includes("fail") || m.includes("error") || m.includes("Error"))).toBe(true);
    });
  });
});
