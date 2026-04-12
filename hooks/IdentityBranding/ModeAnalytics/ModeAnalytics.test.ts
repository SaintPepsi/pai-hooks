import { describe, expect, test } from "bun:test";
import { processExecFailed } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import { ModeAnalytics, type ModeAnalyticsDeps } from "./ModeAnalytics.contract";

function isSilent(output: Record<string, unknown>): boolean {
  return Object.keys(output).length === 0;
}

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const baseInput: SessionEndInput = {
  session_id: "test-session-123",
};

function makeDeps(overrides: Partial<ModeAnalyticsDeps> = {}): ModeAnalyticsDeps {
  return {
    execSyncSafe: () => ok("success"),
    stderr: () => {},
    baseDir: "/tmp/test-pai",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ModeAnalytics", () => {
  describe("contract metadata", () => {
    test("name is ModeAnalytics", () => {
      expect(ModeAnalytics.name).toBe("ModeAnalytics");
    });

    test("event is SessionEnd", () => {
      expect(ModeAnalytics.event).toBe("SessionEnd");
    });
  });

  describe("accepts", () => {
    test("accepts all SessionEnd inputs", () => {
      expect(ModeAnalytics.accepts(baseInput)).toBe(true);
    });

    test("accepts input with empty session_id", () => {
      expect(ModeAnalytics.accepts({ session_id: "" })).toBe(true);
    });
  });

  describe("execute — happy path", () => {
    test("returns ok with silent type when both scripts succeed", () => {
      const deps = makeDeps();
      const result = ModeAnalytics.execute(baseInput, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(isSilent(result.value)).toBe(true);
    });

    test("calls CollectModeData.ts with correct path and timeout", () => {
      const calls: Array<{ cmd: string; opts: { cwd?: string; timeout?: number } | undefined }> =
        [];
      const deps = makeDeps({
        execSyncSafe: (cmd, opts) => {
          calls.push({ cmd, opts });
          return ok("done");
        },
      });
      ModeAnalytics.execute(baseInput, deps);
      expect(calls.length).toBe(2);
      expect(calls[0].cmd).toContain("CollectModeData.ts");
      expect(calls[0].opts).toEqual({ timeout: 30000 });
    });

    test("calls GenerateDashboard.ts with correct path and timeout", () => {
      const calls: Array<{ cmd: string; opts: { cwd?: string; timeout?: number } | undefined }> =
        [];
      const deps = makeDeps({
        execSyncSafe: (cmd, opts) => {
          calls.push({ cmd, opts });
          return ok("done");
        },
      });
      ModeAnalytics.execute(baseInput, deps);
      expect(calls.length).toBe(2);
      expect(calls[1].cmd).toContain("GenerateDashboard.ts");
      expect(calls[1].opts).toEqual({ timeout: 15000 });
    });

    test("builds tool path using baseDir", () => {
      const calls: string[] = [];
      const deps = makeDeps({
        baseDir: "/custom/path",
        execSyncSafe: (cmd) => {
          calls.push(cmd);
          return ok("done");
        },
      });
      ModeAnalytics.execute(baseInput, deps);
      expect(calls[0]).toContain("/custom/path/Tools/mode-analytics/CollectModeData.ts");
      expect(calls[1]).toContain("/custom/path/Tools/mode-analytics/GenerateDashboard.ts");
    });

    test("logs success message when both scripts succeed", () => {
      const messages: string[] = [];
      const deps = makeDeps({
        stderr: (msg) => messages.push(msg),
      });
      ModeAnalytics.execute(baseInput, deps);
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain("Data collected and dashboard regenerated");
    });
  });

  describe("execute — collection failure", () => {
    test("returns ok silent when collection fails", () => {
      const deps = makeDeps({
        execSyncSafe: () => err(processExecFailed("bun collect", new Error("timeout"))),
      });
      const result = ModeAnalytics.execute(baseInput, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(isSilent(result.value)).toBe(true);
    });

    test("logs collection failure message", () => {
      const messages: string[] = [];
      const deps = makeDeps({
        execSyncSafe: () => err(processExecFailed("bun collect", new Error("timeout"))),
        stderr: (msg) => messages.push(msg),
      });
      ModeAnalytics.execute(baseInput, deps);
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain("Collection failed");
    });

    test("does not call GenerateDashboard when collection fails", () => {
      const calls: string[] = [];
      const deps = makeDeps({
        execSyncSafe: (cmd) => {
          calls.push(cmd);
          return err(processExecFailed(cmd, new Error("fail")));
        },
      });
      ModeAnalytics.execute(baseInput, deps);
      // Only one call — collection. Dashboard is never invoked.
      expect(calls.length).toBe(1);
      expect(calls[0]).toContain("CollectModeData.ts");
    });
  });

  describe("execute — dashboard generation failure", () => {
    test("returns ok silent when dashboard generation fails", () => {
      let callIndex = 0;
      const deps = makeDeps({
        execSyncSafe: () => {
          callIndex++;
          if (callIndex === 1) return ok("collected");
          return err(processExecFailed("bun generate", new Error("fail")));
        },
      });
      const result = ModeAnalytics.execute(baseInput, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(isSilent(result.value)).toBe(true);
    });

    test("logs dashboard failure message", () => {
      const messages: string[] = [];
      let callIndex = 0;
      const deps = makeDeps({
        execSyncSafe: () => {
          callIndex++;
          if (callIndex === 1) return ok("collected");
          return err(processExecFailed("bun generate", new Error("fail")));
        },
        stderr: (msg) => messages.push(msg),
      });
      ModeAnalytics.execute(baseInput, deps);
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain("Dashboard generation failed");
    });
  });
});
