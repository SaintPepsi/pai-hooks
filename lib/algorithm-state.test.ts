/**
 * Tests for lib/algorithm-state.ts — Single source of truth for algorithm state management.
 *
 * Uses makeAlgorithmDeps() factory with a Map-backed in-memory filesystem.
 * No real I/O — all filesystem calls are intercepted by fake deps.
 */

import { describe, expect, it } from "bun:test";
import type { ResultError } from "@hooks/core/error";
import { jsonParseFailed } from "@hooks/core/error";
import { err, ok, tryCatch } from "@hooks/core/result";
import type {
  AlgorithmCriterion,
  AlgorithmState,
  AlgorithmStateDeps,
} from "@hooks/lib/algorithm-state";
import {
  agentAdd,
  algorithmAbandon,
  algorithmEnd,
  criteriaAdd,
  criteriaUpdate,
  effortLevelUpdate,
  phaseTransition,
  readState,
  sweepStaleActive,
  writeState,
} from "@hooks/lib/algorithm-state";

// ─── Fake deps factory ────────────────────────────────────────────────────────

interface AlgorithmDepsOptions {
  baseDir?: string;
  /** Per-path mtime overrides for stat(). Falls back to Date.now() if not set. */
  mtimeOverrides?: Map<string, number>;
}

function makeAlgorithmDeps(baseDir?: string): AlgorithmStateDeps;
function makeAlgorithmDeps(opts: AlgorithmDepsOptions): AlgorithmStateDeps;
function makeAlgorithmDeps(arg?: string | AlgorithmDepsOptions): AlgorithmStateDeps {
  arg = arg ?? "/fake/pai";
  const baseDir = typeof arg === "string" ? arg : (arg.baseDir ?? "/fake/pai");
  const mtimeOverrides = typeof arg === "string" ? undefined : arg.mtimeOverrides;
  const files = new Map<string, string>();

  return {
    baseDir,
    stderr: (_msg: string) => {},
    fileExists: (path: string) => files.has(path),
    readFile: (path: string) => {
      const content = files.get(path);
      if (content === undefined)
        return err({ code: "FILE_NOT_FOUND", message: "not found" } as ResultError);
      return ok(content);
    },
    writeFile: (path: string, content: string) => {
      files.set(path, content);
      return ok(undefined);
    },
    ensureDir: (path: string) => {
      files.set(`__dir__${path}`, "");
      return ok(undefined);
    },
    readJson: <T>(path: string) => {
      const content = files.get(path);
      if (content === undefined)
        return err<T, ResultError>({ code: "FILE_NOT_FOUND", message: "not found" } as ResultError);
      const parsed = tryCatch(
        () => JSON.parse(content) as unknown,
        (e) => jsonParseFailed(content.slice(0, 80), e),
      );
      if (!parsed.ok) return err<T, ResultError>(parsed.error);
      return ok<T, ResultError>(parsed.value as T);
    },
    readDir: (path: string) => {
      const prefix = `${path}/`;
      const entries = [...files.keys()]
        .filter((k) => k.startsWith(prefix) && !k.startsWith("__dir__"))
        .map((k) => k.slice(prefix.length));
      return ok(entries);
    },
    removeFile: (path: string) => {
      files.delete(path);
      return ok(undefined);
    },
    stat: (path: string) => {
      if (!files.has(path))
        return err({ code: "FILE_NOT_FOUND", message: "not found" } as ResultError);
      const mtimeMs = mtimeOverrides?.get(path) ?? Date.now();
      return ok({ mtimeMs, isDirectory: () => false });
    },
  };
}

function makeCriterion(overrides: Partial<AlgorithmCriterion> = {}): AlgorithmCriterion {
  return {
    id: "ISC-C1",
    description: "The feature works correctly",
    type: "criterion",
    status: "pending",
    createdInPhase: "OBSERVE",
    ...overrides,
  };
}

// ─── readState / writeState ───────────────────────────────────────────────────

describe("readState", () => {
  it("returns null when no state file exists", () => {
    const deps = makeAlgorithmDeps();
    expect(readState("session-abc", deps)).toBeNull();
  });

  it("returns null for an empty file", () => {
    const deps = makeAlgorithmDeps();
    const path = "/fake/pai/MEMORY/STATE/algorithms/session-abc.json";
    deps.writeFile(path, "");
    expect(readState("session-abc", deps)).toBeNull();
  });

  it("returns null for a file containing only '{}'", () => {
    const deps = makeAlgorithmDeps();
    const path = "/fake/pai/MEMORY/STATE/algorithms/session-abc.json";
    deps.writeFile(path, "{}");
    expect(readState("session-abc", deps)).toBeNull();
  });

  it("returns parsed state for a valid file", () => {
    const deps = makeAlgorithmDeps();
    const state: AlgorithmState = {
      active: true,
      sessionId: "session-abc",
      taskDescription: "Fix the bug",
      currentPhase: "BUILD",
      phaseStartedAt: Date.now(),
      algorithmStartedAt: Date.now(),
      sla: "Standard",
      criteria: [],
      agents: [],
      capabilities: ["Task Tool"],
      phaseHistory: [],
    };
    const path = "/fake/pai/MEMORY/STATE/algorithms/session-abc.json";
    deps.writeFile(path, JSON.stringify(state));
    const result = readState("session-abc", deps);
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("session-abc");
    expect(result!.currentPhase).toBe("BUILD");
  });
});

describe("writeState", () => {
  it("persists state that can be read back", () => {
    const deps = makeAlgorithmDeps();
    const state: AlgorithmState = {
      active: true,
      sessionId: "sess-write",
      taskDescription: "Test task",
      currentPhase: "THINK",
      phaseStartedAt: Date.now(),
      algorithmStartedAt: Date.now(),
      sla: "Extended",
      criteria: [],
      agents: [],
      capabilities: ["Task Tool"],
      phaseHistory: [],
    };
    writeState(state, deps);
    const result = readState("sess-write", deps);
    expect(result).not.toBeNull();
    expect(result!.currentPhase).toBe("THINK");
  });

  it("syncs effortLevel to match sla on write", () => {
    const deps = makeAlgorithmDeps();
    const state: AlgorithmState = {
      active: true,
      sessionId: "sess-effort",
      taskDescription: "Test",
      currentPhase: "OBSERVE",
      phaseStartedAt: Date.now(),
      algorithmStartedAt: Date.now(),
      sla: "Deep",
      criteria: [],
      agents: [],
      capabilities: [],
      phaseHistory: [],
    };
    writeState(state, deps);
    const result = readState("sess-effort", deps);
    expect(result!.effortLevel).toBe("Deep");
  });
});

// ─── phaseTransition ──────────────────────────────────────────────────────────

describe("phaseTransition", () => {
  it("creates new state when no prior state exists", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-new", "OBSERVE", deps);
    const state = readState("sess-new", deps);
    expect(state).not.toBeNull();
    expect(state!.currentPhase).toBe("OBSERVE");
    expect(state!.active).toBe(true);
  });

  it("updates currentPhase on normal transition", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-p", "OBSERVE", deps);
    phaseTransition("sess-p", "THINK", deps);
    const state = readState("sess-p", deps);
    expect(state!.currentPhase).toBe("THINK");
  });

  it("adds entry to phaseHistory on each transition", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-hist", "OBSERVE", deps);
    phaseTransition("sess-hist", "THINK", deps);
    phaseTransition("sess-hist", "PLAN", deps);
    const state = readState("sess-hist", deps);
    expect(state!.phaseHistory.length).toBeGreaterThanOrEqual(3);
  });

  it("sets completedAt when transitioning to LEARN", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-learn", "OBSERVE", deps);
    phaseTransition("sess-learn", "LEARN", deps);
    const state = readState("sess-learn", deps);
    expect(state!.completedAt).toBeDefined();
  });

  it("detects rework when OBSERVE follows LEARN on a session with prior work", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-rework", "OBSERVE", deps);
    // Add a criterion to mark prior work
    criteriaAdd("sess-rework", makeCriterion(), deps);
    phaseTransition("sess-rework", "LEARN", deps);
    // Now re-enter OBSERVE (rework)
    phaseTransition("sess-rework", "OBSERVE", deps);
    const state = readState("sess-rework", deps);
    expect(state!.isRework).toBe(true);
    expect(state!.reworkCount).toBe(1);
    expect(state!.reworkHistory).toHaveLength(1);
  });

  it("resets criteria and phaseHistory on new run detection", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-reset", "OBSERVE", deps);
    criteriaAdd("sess-reset", makeCriterion(), deps);
    phaseTransition("sess-reset", "LEARN", deps);
    phaseTransition("sess-reset", "OBSERVE", deps);
    const state = readState("sess-reset", deps);
    // criteria and phaseHistory reset for the new run
    expect(state!.criteria).toHaveLength(0);
    expect(state!.phaseHistory).toHaveLength(1);
  });

  it("closes previous phase entry with completedAt", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-close", "OBSERVE", deps);
    phaseTransition("sess-close", "THINK", deps);
    const state = readState("sess-close", deps);
    const observeEntry = state!.phaseHistory.find((e) => e.phase === "OBSERVE");
    expect(observeEntry?.completedAt).toBeDefined();
  });
});

// ─── criteriaAdd ──────────────────────────────────────────────────────────────

describe("criteriaAdd", () => {
  it("creates state and adds criterion when no prior state exists", () => {
    const deps = makeAlgorithmDeps();
    criteriaAdd("sess-ca", makeCriterion({ id: "ISC-C1" }), deps);
    const state = readState("sess-ca", deps);
    expect(state).not.toBeNull();
    expect(state!.criteria).toHaveLength(1);
    expect(state!.criteria[0].id).toBe("ISC-C1");
  });

  it("does not add duplicate criteria (same id)", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-dedup", "OBSERVE", deps);
    criteriaAdd("sess-dedup", makeCriterion({ id: "ISC-C1" }), deps);
    criteriaAdd("sess-dedup", makeCriterion({ id: "ISC-C1" }), deps);
    const state = readState("sess-dedup", deps);
    expect(state!.criteria).toHaveLength(1);
  });

  it("adds multiple distinct criteria", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-multi", "OBSERVE", deps);
    criteriaAdd("sess-multi", makeCriterion({ id: "ISC-C1" }), deps);
    criteriaAdd("sess-multi", makeCriterion({ id: "ISC-C2", description: "Second" }), deps);
    const state = readState("sess-multi", deps);
    expect(state!.criteria).toHaveLength(2);
  });

  it("reactivates a completed session and archives prior cycle", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-react", "OBSERVE", deps);
    criteriaAdd("sess-react", makeCriterion({ id: "ISC-C1" }), deps);
    // Mark as completed
    algorithmEnd(
      "sess-react",
      { isAlgorithmResponse: true, taskDescription: "Done" },
      deps,
    );
    // Force inactive
    const s = readState("sess-react", deps)!;
    s.active = false;
    s.currentPhase = "COMPLETE";
    writeState(s, deps);

    // New criterion arrives — should reactivate
    criteriaAdd("sess-react", makeCriterion({ id: "ISC-C2", description: "New run" }), deps);
    const state = readState("sess-react", deps);
    expect(state!.active).toBe(true);
    expect(state!.criteria).toHaveLength(1);
    expect(state!.criteria[0].id).toBe("ISC-C2");
  });
});

// ─── criteriaUpdate ───────────────────────────────────────────────────────────

describe("criteriaUpdate", () => {
  it("does nothing when no state exists", () => {
    const deps = makeAlgorithmDeps();
    expect(() => criteriaUpdate("sess-nostate", "task-1", "completed", deps)).not.toThrow();
  });

  it("updates criterion status by taskId", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-cu", "OBSERVE", deps);
    criteriaAdd("sess-cu", makeCriterion({ id: "ISC-C1", taskId: "task-42" }), deps);
    criteriaUpdate("sess-cu", "task-42", "completed", deps);
    const state = readState("sess-cu", deps);
    expect(state!.criteria[0].status).toBe("completed");
  });

  it("does nothing when taskId is not found", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-notask", "OBSERVE", deps);
    criteriaAdd("sess-notask", makeCriterion({ id: "ISC-C1", taskId: "task-1" }), deps);
    criteriaUpdate("sess-notask", "task-999", "completed", deps);
    const state = readState("sess-notask", deps);
    expect(state!.criteria[0].status).toBe("pending");
  });
});

// ─── effortLevelUpdate ────────────────────────────────────────────────────────

describe("effortLevelUpdate", () => {
  it("does nothing when no state exists", () => {
    const deps = makeAlgorithmDeps();
    expect(() => effortLevelUpdate("sess-nostate", "Extended", deps)).not.toThrow();
  });

  it("updates the sla field", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-elu", "OBSERVE", deps);
    effortLevelUpdate("sess-elu", "Advanced", deps);
    const state = readState("sess-elu", deps);
    expect(state!.sla).toBe("Advanced");
  });

  it("syncs effortLevel via writeState after update", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-sync", "OBSERVE", deps);
    effortLevelUpdate("sess-sync", "Deep", deps);
    const state = readState("sess-sync", deps);
    expect(state!.effortLevel).toBe("Deep");
  });
});

// ─── agentAdd ────────────────────────────────────────────────────────────────

describe("agentAdd", () => {
  it("does nothing when no state exists", () => {
    const deps = makeAlgorithmDeps();
    expect(() =>
      agentAdd("sess-nostate", { name: "Agent-1", agentType: "Review" }, deps),
    ).not.toThrow();
  });

  it("adds an agent to the state", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-agent", "EXECUTE", deps);
    agentAdd("sess-agent", { name: "Agent-1", agentType: "Code", task: "Fix bug" }, deps);
    const state = readState("sess-agent", deps);
    expect(state!.agents).toHaveLength(1);
    expect(state!.agents[0].name).toBe("Agent-1");
    expect(state!.agents[0].status).toBe("active");
    expect(state!.agents[0].agentType).toBe("Code");
  });

  it("does not add duplicate agents (same name)", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-dedup-agent", "EXECUTE", deps);
    agentAdd("sess-dedup-agent", { name: "Agent-1", agentType: "Code" }, deps);
    agentAdd("sess-dedup-agent", { name: "Agent-1", agentType: "Code" }, deps);
    const state = readState("sess-dedup-agent", deps);
    expect(state!.agents).toHaveLength(1);
  });

  it("records current phase on the agent entry", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-agent-phase", "BUILD", deps);
    agentAdd("sess-agent-phase", { name: "Builder-1", agentType: "Build" }, deps);
    const state = readState("sess-agent-phase", deps);
    expect(state!.agents[0].phase).toBe("BUILD");
  });

  it("stores criteriaIds when provided", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-agent-cids", "BUILD", deps);
    agentAdd(
      "sess-agent-cids",
      { name: "Agent-2", agentType: "Impl", criteriaIds: ["ISC-C1", "ISC-C2"] },
      deps,
    );
    const state = readState("sess-agent-cids", deps);
    expect(state!.agents[0].criteriaIds).toEqual(["ISC-C1", "ISC-C2"]);
  });
});

// ─── algorithmEnd ─────────────────────────────────────────────────────────────

describe("algorithmEnd", () => {
  it("creates state when none exists for algorithm responses", () => {
    const deps = makeAlgorithmDeps();
    algorithmEnd("sess-end-new", { isAlgorithmResponse: true, taskDescription: "New task" }, deps);
    const state = readState("sess-end-new", deps);
    expect(state).not.toBeNull();
    expect(state!.taskDescription).toBe("New task");
  });

  it("enriches taskDescription when provided", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-enrich", "OBSERVE", deps);
    algorithmEnd(
      "sess-enrich",
      { isAlgorithmResponse: true, taskDescription: "Fix auth bug" },
      deps,
    );
    const state = readState("sess-enrich", deps);
    expect(state!.taskDescription).toBe("Fix auth bug");
  });

  it("enriches summary when provided", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-summary", "LEARN", deps);
    algorithmEnd(
      "sess-summary",
      { isAlgorithmResponse: true, summary: "All criteria passed." },
      deps,
    );
    const state = readState("sess-summary", deps);
    expect(state!.summary).toBe("All criteria passed.");
  });

  it("marks session as complete (active=false) when phase is LEARN", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-terminal", "OBSERVE", deps);
    phaseTransition("sess-terminal", "LEARN", deps);
    algorithmEnd("sess-terminal", { isAlgorithmResponse: true }, deps);
    const state = readState("sess-terminal", deps);
    expect(state!.active).toBe(false);
    expect(state!.currentPhase).toBe("COMPLETE");
    expect(state!.completedAt).toBeDefined();
  });

  it("marks session as complete when phase is COMPLETE", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-comp", "OBSERVE", deps);
    // Force to COMPLETE
    const s = readState("sess-comp", deps)!;
    s.currentPhase = "COMPLETE";
    writeState(s, deps);
    algorithmEnd("sess-comp", { isAlgorithmResponse: true }, deps);
    const state = readState("sess-comp", deps);
    expect(state!.active).toBe(false);
  });

  it("deactivates optimistically-activated session on non-algorithm response", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-deact", "OBSERVE", deps);
    // Session was activated but no criteria and only 1 phase entry
    algorithmEnd("sess-deact", { isAlgorithmResponse: false }, deps);
    const state = readState("sess-deact", deps);
    expect(state!.active).toBe(false);
  });

  it("does nothing to multi-phase session on non-algorithm response", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-keep", "OBSERVE", deps);
    phaseTransition("sess-keep", "THINK", deps);
    algorithmEnd("sess-keep", { isAlgorithmResponse: false }, deps);
    const state = readState("sess-keep", deps);
    // Has 2 phase entries — not deactivated
    expect(state!.active).toBe(true);
  });

  it("merges criteria from enrichment (advancing status only)", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-merge", "OBSERVE", deps);
    criteriaAdd("sess-merge", makeCriterion({ id: "ISC-C1", status: "pending" }), deps);

    algorithmEnd(
      "sess-merge",
      {
        isAlgorithmResponse: true,
        criteria: [makeCriterion({ id: "ISC-C1", status: "completed" })],
      },
      deps,
    );
    const state = readState("sess-merge", deps);
    expect(state!.criteria[0].status).toBe("completed");
  });

  it("does not downgrade criterion status during merge", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-nodown", "OBSERVE", deps);
    criteriaAdd("sess-nodown", makeCriterion({ id: "ISC-C1", status: "completed" }), deps);

    algorithmEnd(
      "sess-nodown",
      {
        isAlgorithmResponse: true,
        criteria: [makeCriterion({ id: "ISC-C1", status: "pending" })],
      },
      deps,
    );
    const state = readState("sess-nodown", deps);
    expect(state!.criteria[0].status).toBe("completed");
  });

  it("adds new criteria from enrichment that were not tracked in real-time", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-addnew", "OBSERVE", deps);

    algorithmEnd(
      "sess-addnew",
      {
        isAlgorithmResponse: true,
        criteria: [makeCriterion({ id: "ISC-C99", description: "Missed by tracker" })],
      },
      deps,
    );
    const state = readState("sess-addnew", deps);
    expect(state!.criteria.some((c) => c.id === "ISC-C99")).toBe(true);
  });
});

// ─── sweepStaleActive ─────────────────────────────────────────────────────────

describe("sweepStaleActive", () => {
  const ALGORITHMS_DIR = "/fake/pai/MEMORY/STATE/algorithms";

  /** Write a state file with a specific mtime so sweep sees it as old/fresh. */
  function seedSession(
    deps: AlgorithmStateDeps,
    sessionId: string,
    state: AlgorithmState,
    mtimeOverrides: Map<string, number>,
    ageMs: number,
  ): void {
    writeState(state, deps);
    const filepath = `${ALGORITHMS_DIR}/${sessionId}.json`;
    mtimeOverrides.set(filepath, Date.now() - ageMs);
  }

  it("marks a stale active session as complete when it exceeds the phase threshold", () => {
    const mtimeOverrides = new Map<string, number>();
    const deps = makeAlgorithmDeps({ baseDir: "/fake/pai", mtimeOverrides });

    const state: AlgorithmState = {
      active: true,
      sessionId: "sess-stale",
      taskDescription: "Old task",
      currentPhase: "OBSERVE", // threshold = 15 min
      phaseStartedAt: Date.now() - 20 * 60 * 1000,
      algorithmStartedAt: Date.now() - 20 * 60 * 1000,
      sla: "Standard",
      criteria: [],
      agents: [],
      capabilities: [],
      phaseHistory: [],
    };
    seedSession(deps, "sess-stale", state, mtimeOverrides, 20 * 60 * 1000); // 20 min old

    sweepStaleActive("current-session", deps);

    const updated = readState("sess-stale", deps);
    expect(updated!.active).toBe(false);
    expect(updated!.currentPhase).toBe("COMPLETE");
  });

  it("skips the currentSessionId", () => {
    const mtimeOverrides = new Map<string, number>();
    const deps = makeAlgorithmDeps({ baseDir: "/fake/pai", mtimeOverrides });

    const state: AlgorithmState = {
      active: true,
      sessionId: "current-session",
      taskDescription: "Current task",
      currentPhase: "OBSERVE",
      phaseStartedAt: Date.now() - 20 * 60 * 1000,
      algorithmStartedAt: Date.now() - 20 * 60 * 1000,
      sla: "Standard",
      criteria: [],
      agents: [],
      capabilities: [],
      phaseHistory: [],
    };
    seedSession(deps, "current-session", state, mtimeOverrides, 20 * 60 * 1000);

    sweepStaleActive("current-session", deps);

    // Should remain untouched — current session is skipped
    const updated = readState("current-session", deps);
    expect(updated!.active).toBe(true);
  });

  it("deletes completed sessions older than 25 hours", () => {
    const mtimeOverrides = new Map<string, number>();
    const deps = makeAlgorithmDeps({ baseDir: "/fake/pai", mtimeOverrides });

    const state: AlgorithmState = {
      active: false,
      sessionId: "sess-old-done",
      taskDescription: "Finished long ago",
      currentPhase: "COMPLETE",
      phaseStartedAt: Date.now() - 26 * 60 * 60 * 1000,
      algorithmStartedAt: Date.now() - 26 * 60 * 60 * 1000,
      sla: "Standard",
      criteria: [],
      agents: [],
      capabilities: [],
      phaseHistory: [],
      completedAt: Date.now() - 26 * 60 * 60 * 1000,
    };
    seedSession(deps, "sess-old-done", state, mtimeOverrides, 25 * 60 * 60 * 1000); // 25 hr old

    sweepStaleActive("current-session", deps);

    // File should be deleted — readState returns null
    const result = readState("sess-old-done", deps);
    expect(result).toBeNull();
  });

  it("does not mark a fresh active session as stale", () => {
    const mtimeOverrides = new Map<string, number>();
    const deps = makeAlgorithmDeps({ baseDir: "/fake/pai", mtimeOverrides });

    const state: AlgorithmState = {
      active: true,
      sessionId: "sess-fresh",
      taskDescription: "Recent task",
      currentPhase: "BUILD", // threshold = 60 min
      phaseStartedAt: Date.now() - 5 * 60 * 1000,
      algorithmStartedAt: Date.now() - 5 * 60 * 1000,
      sla: "Standard",
      criteria: [],
      agents: [],
      capabilities: [],
      phaseHistory: [],
    };
    seedSession(deps, "sess-fresh", state, mtimeOverrides, 5 * 60 * 1000); // 5 min old

    sweepStaleActive("current-session", deps);

    const updated = readState("sess-fresh", deps);
    expect(updated!.active).toBe(true);
  });
});

// ─── algorithmAbandon ─────────────────────────────────────────────────────────

describe("algorithmAbandon", () => {
  it("marks an active session as abandoned and inactive", () => {
    const deps = makeAlgorithmDeps();
    phaseTransition("sess-abandon", "BUILD", deps);

    const result = algorithmAbandon("sess-abandon", deps);

    expect(result).toBe(true);
    const state = readState("sess-abandon", deps);
    expect(state!.abandoned).toBe(true);
    expect(state!.active).toBe(false);
    expect(state!.completedAt).toBeDefined();
  });

  it("returns false when session does not exist", () => {
    const deps = makeAlgorithmDeps();
    const result = algorithmAbandon("nonexistent-session", deps);
    expect(result).toBe(false);
  });
});
