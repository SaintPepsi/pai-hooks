/**
 * CronPrune Contract Tests — TDD RED phase.
 *
 * Validates that stale session cron files are pruned on SessionStart
 * while fresh files are left intact.
 */

import { describe, expect, it } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import {
  CronPrune,
  type CronPruneDeps,
  cronIntervalMs,
  DEFAULT_PRUNE_THRESHOLD_MS,
} from "@hooks/hooks/CronStatusLine/CronPrune/CronPrune.contract";
import type { CronSessionFile } from "@hooks/hooks/CronStatusLine/shared";

// ─── Test Helpers ────────────────────────────────────────────────────────────

// Default mock cron has "* * * * *" which returns DEFAULT_PRUNE_THRESHOLD_MS from cronIntervalMs.
// Dynamic threshold = 2x that = 10 minutes. Set stale time to exceed it.
const STALE_AGO = Date.now() - DEFAULT_PRUNE_THRESHOLD_MS * 2 - 1000;
const ONE_MINUTE_AGO = Date.now() - 60_000;

function makeDeps(overrides: Partial<CronPruneDeps> = {}): CronPruneDeps {
  return {
    getEnv: (key: string) => {
      if (key === "PAI_DIR") return "/tmp/test-pai";
      if (key === "HOME") return "/tmp";
      return undefined;
    },
    readFile: () =>
      ok(
        JSON.stringify({
          sessionId: "dead-session",
          crons: [
            {
              id: "c1",
              name: "test",
              schedule: "* * * * *",
              recurring: true,
              prompt: "hello",
              createdAt: 0,
              fireCount: 0,
              lastFired: null,
            },
          ],
        }),
      ),
    writeFile: () => ok(undefined),
    fileExists: () => true,
    ensureDir: () => ok(undefined),
    readDir: () => ok(["dead-session.json"]),
    removeFile: () => ok(undefined),
    appendFile: () => ok(undefined),
    stderr: () => {},
    now: () => Date.now(),
    stat: () => ok({ mtimeMs: STALE_AGO }),
    ...overrides,
  };
}

function makeInput(sessionId = "current-session"): SessionStartInput {
  return { session_id: sessionId };
}

// ─── Contract Metadata ──────────────────────────────────────────────────────

describe("CronPrune contract", () => {
  it("has correct name and event", () => {
    expect(CronPrune.name).toBe("CronPrune");
    expect(CronPrune.event).toBe("SessionStart");
  });

  it("accepts() always returns true", () => {
    expect(CronPrune.accepts(makeInput())).toBe(true);
    expect(CronPrune.accepts(makeInput("other"))).toBe(true);
  });
});

// ─── Pruning Logic ──────────────────────────────────────────────────────────

describe("CronPrune execute", () => {
  it("removes files older than 5 minutes", () => {
    const removed: string[] = [];
    const deps = makeDeps({
      removeFile: (path: string) => {
        removed.push(path);
        return ok(undefined);
      },
    });

    const result = CronPrune.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(removed.length).toBe(1);
    expect(removed[0]).toContain("dead-session.json");
  });

  it("keeps files younger than 5 minutes", () => {
    const removed: string[] = [];
    const deps = makeDeps({
      stat: () => ok({ mtimeMs: ONE_MINUTE_AGO }),
      removeFile: (path: string) => {
        removed.push(path);
        return ok(undefined);
      },
    });

    const result = CronPrune.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(removed.length).toBe(0);
  });

  it("no-op when crons directory does not exist", () => {
    const removed: string[] = [];
    const deps = makeDeps({
      fileExists: () => false,
      readDir: () => err(new ResultError(ErrorCode.FileReadFailed, "no such dir")),
      removeFile: (path: string) => {
        removed.push(path);
        return ok(undefined);
      },
    });

    const result = CronPrune.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
    expect(removed.length).toBe(0);
  });

  it("logs pruned event with session ID and cron count", () => {
    const logged: string[] = [];
    const sessionFile: CronSessionFile = {
      sessionId: "dead-session",
      crons: [
        {
          id: "c1",
          name: "test1",
          schedule: "* * * * *",
          recurring: true,
          prompt: "p1",
          createdAt: 0,
          fireCount: 0,
          lastFired: null,
        },
        {
          id: "c2",
          name: "test2",
          schedule: "*/5 * * * *",
          recurring: true,
          prompt: "p2",
          createdAt: 0,
          fireCount: 0,
          lastFired: null,
        },
      ],
    };
    const deps = makeDeps({
      readFile: () => ok(JSON.stringify(sessionFile)),
      appendFile: (_path: string, content: string) => {
        logged.push(content);
        return ok(undefined);
      },
    });

    const result = CronPrune.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(logged.length).toBe(1);

    const event = JSON.parse(logged[0]);
    expect(event.type).toBe("pruned");
    expect(event.sessionId).toBe("dead-session");
    expect(event.cronCount).toBe(2);
    expect(event.reason).toBe("session_dead");
  });

  it("handles stat failures gracefully — skips file, does not crash", () => {
    const removed: string[] = [];
    const deps = makeDeps({
      readDir: () => ok(["bad-file.json", "good-file.json"]),
      stat: (path: string) => {
        if (path.includes("bad-file")) {
          return err(new ResultError(ErrorCode.FileReadFailed, "stat failed"));
        }
        return ok({ mtimeMs: STALE_AGO });
      },
      removeFile: (path: string) => {
        removed.push(path);
        return ok(undefined);
      },
    });

    const result = CronPrune.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    // Only the good file was removed, bad file was skipped
    expect(removed.length).toBe(1);
    expect(removed[0]).toContain("good-file.json");
  });

  it("handles multiple stale files in one pass", () => {
    const removed: string[] = [];
    const deps = makeDeps({
      readDir: () => ok(["session-a.json", "session-b.json", "session-c.json"]),
      removeFile: (path: string) => {
        removed.push(path);
        return ok(undefined);
      },
    });

    const result = CronPrune.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(removed.length).toBe(3);
  });

  it("ignores non-.json files in crons directory", () => {
    const removed: string[] = [];
    const deps = makeDeps({
      readDir: () => ok(["readme.txt", ".gitkeep", "session.json"]),
      removeFile: (path: string) => {
        removed.push(path);
        return ok(undefined);
      },
    });

    const result = CronPrune.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    // Only the .json file should be considered
    expect(removed.length).toBe(1);
    expect(removed[0]).toContain("session.json");
  });

  it("returns silent output on success", () => {
    const deps = makeDeps();
    const result = CronPrune.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it("uses dynamic threshold based on longest cron interval (2x)", () => {
    const removed: string[] = [];
    // File is 20 minutes old — stale by default 5min threshold,
    // but the cron runs every 30 min, so 2x = 60 min threshold → keep it
    const twentyMinAgo = Date.now() - 20 * 60 * 1000;
    const sessionFile: CronSessionFile = {
      sessionId: "long-cron-session",
      crons: [
        {
          id: "c1",
          name: "chore-loop",
          schedule: "*/30 * * * *",
          recurring: true,
          prompt: "chore",
          createdAt: 0,
          fireCount: 0,
          lastFired: null,
        },
      ],
    };
    const deps = makeDeps({
      stat: () => ok({ mtimeMs: twentyMinAgo }),
      readFile: () => ok(JSON.stringify(sessionFile)),
      removeFile: (path: string) => {
        removed.push(path);
        return ok(undefined);
      },
    });

    const result = CronPrune.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(removed.length).toBe(0); // NOT pruned — within 2x 30min threshold
  });

  it("prunes file when older than 2x longest cron interval", () => {
    const removed: string[] = [];
    // File is 70 minutes old, cron is every 30 min → 2x = 60 min → prune
    const seventyMinAgo = Date.now() - 70 * 60 * 1000;
    const sessionFile: CronSessionFile = {
      sessionId: "expired-session",
      crons: [
        {
          id: "c1",
          name: "chore-loop",
          schedule: "*/30 * * * *",
          recurring: true,
          prompt: "chore",
          createdAt: 0,
          fireCount: 0,
          lastFired: null,
        },
      ],
    };
    const deps = makeDeps({
      stat: () => ok({ mtimeMs: seventyMinAgo }),
      readFile: () => ok(JSON.stringify(sessionFile)),
      removeFile: (path: string) => {
        removed.push(path);
        return ok(undefined);
      },
    });

    const result = CronPrune.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(removed.length).toBe(1);
  });

  it("uses longest cron interval when file has multiple crons", () => {
    const removed: string[] = [];
    // File is 15 minutes old, has 5min and 30min crons → 2x 30min = 60 min → keep
    const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
    const sessionFile: CronSessionFile = {
      sessionId: "multi-cron",
      crons: [
        {
          id: "c1",
          name: "fast-poll",
          schedule: "*/5 * * * *",
          recurring: true,
          prompt: "poll",
          createdAt: 0,
          fireCount: 0,
          lastFired: null,
        },
        {
          id: "c2",
          name: "chore-loop",
          schedule: "*/30 * * * *",
          recurring: true,
          prompt: "chore",
          createdAt: 0,
          fireCount: 0,
          lastFired: null,
        },
      ],
    };
    const deps = makeDeps({
      stat: () => ok({ mtimeMs: fifteenMinAgo }),
      readFile: () => ok(JSON.stringify(sessionFile)),
      removeFile: (path: string) => {
        removed.push(path);
        return ok(undefined);
      },
    });

    const result = CronPrune.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(removed.length).toBe(0);
  });
});

// ─── cronIntervalMs ──────────────────────────────────────────────────────────

describe("cronIntervalMs", () => {
  it("parses */N minute patterns", () => {
    expect(cronIntervalMs("*/5 * * * *")).toBe(5 * 60 * 1000);
    expect(cronIntervalMs("*/30 * * * *")).toBe(30 * 60 * 1000);
    expect(cronIntervalMs("*/1 * * * *")).toBe(60 * 1000);
  });

  it("parses */N hour patterns", () => {
    expect(cronIntervalMs("0 */2 * * *")).toBe(2 * 3600 * 1000);
    expect(cronIntervalMs("0 */6 * * *")).toBe(6 * 3600 * 1000);
  });

  it("parses specific minute + wildcard hour as hourly", () => {
    expect(cronIntervalMs("15 * * * *")).toBe(3600 * 1000);
    expect(cronIntervalMs("0 * * * *")).toBe(3600 * 1000);
  });

  it("parses specific minute + specific hour as daily", () => {
    expect(cronIntervalMs("30 9 * * *")).toBe(86400 * 1000);
    expect(cronIntervalMs("0 0 * * *")).toBe(86400 * 1000);
  });

  it("returns default for unparseable expressions", () => {
    expect(cronIntervalMs("bad")).toBe(DEFAULT_PRUNE_THRESHOLD_MS);
    expect(cronIntervalMs("")).toBe(DEFAULT_PRUNE_THRESHOLD_MS);
    expect(cronIntervalMs("* * * * *")).toBe(DEFAULT_PRUNE_THRESHOLD_MS); // every minute, but * doesn't match */N
  });
});

// ─── Error and defaultDeps branches ─────────────────────────────────────────

describe("CronPrune — readDir error path", () => {
  it("returns silent when readDir fails", () => {
    const deps = makeDeps({
      readDir: () => err(new ResultError(ErrorCode.FileReadFailed, "permission denied")),
    });
    const result = CronPrune.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });
});

describe("CronPrune defaultDeps", () => {
  it("defaultDeps.readDir returns string[] for existing directory", () => {
    const result = CronPrune.defaultDeps.readDir("/tmp");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.value)).toBe(true);
      for (const entry of result.value) {
        expect(typeof entry).toBe("string");
      }
    }
  });

  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => CronPrune.defaultDeps.stderr("test")).not.toThrow();
  });
});
