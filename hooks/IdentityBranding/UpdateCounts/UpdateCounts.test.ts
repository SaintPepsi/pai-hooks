import { describe, expect, it, mock } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import type { UpdateCountsDeps } from "./UpdateCounts.contract";
import { UpdateCounts } from "./UpdateCounts.contract";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<SessionEndInput> = {}): SessionEndInput {
  return {
    session_id: "test-session",
    transcript_path: "/dev/null",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<UpdateCountsDeps> = {}): UpdateCountsDeps {
  return {
    spawnBackground: mock(() => ok(undefined)),
    hooksDir: "/tmp/test/hooks",
    stderr: mock(() => {}),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("UpdateCounts", () => {
  describe("accepts", () => {
    it("accepts all SessionEnd inputs", () => {
      expect(UpdateCounts.accepts(makeInput())).toBe(true);
    });

    it("accepts regardless of session_id", () => {
      expect(UpdateCounts.accepts(makeInput({ session_id: "" }))).toBe(true);
    });
  });

  describe("execute", () => {
    it("spawns handler as background process", () => {
      const deps = makeDeps();
      const result = UpdateCounts.execute(makeInput(), deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({});
      }
      expect(deps.spawnBackground).toHaveBeenCalledTimes(1);
      expect(deps.spawnBackground).toHaveBeenCalledWith("bun", [
        "/tmp/test/hooks/handlers/UpdateCounts.ts",
      ]);
    });

    it("returns silent even when spawn fails", () => {
      const spawnError = new ResultError(ErrorCode.ProcessSpawnFailed, "spawn failed");
      const deps = makeDeps({
        spawnBackground: mock(() => err(spawnError)),
      });

      const result = UpdateCounts.execute(makeInput(), deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({});
      }
      expect(deps.stderr).toHaveBeenCalledTimes(1);
    });

    it("logs error message when spawn fails", () => {
      const spawnError = new ResultError(ErrorCode.ProcessSpawnFailed, "bun not found");
      const stderrMessages: string[] = [];
      const deps = makeDeps({
        spawnBackground: mock(() => err(spawnError)),
        stderr: mock((msg: string) => {
          stderrMessages.push(msg);
        }),
      });

      UpdateCounts.execute(makeInput(), deps);

      expect(stderrMessages[0]).toContain("bun not found");
    });

    it("does not log on successful spawn", () => {
      const deps = makeDeps();

      UpdateCounts.execute(makeInput(), deps);

      expect(deps.stderr).not.toHaveBeenCalled();
    });

    it("constructs correct handler path from hooksDir", () => {
      const deps = makeDeps({ hooksDir: "/custom/path/hooks" });

      UpdateCounts.execute(makeInput(), deps);

      expect(deps.spawnBackground).toHaveBeenCalledWith("bun", [
        "/custom/path/hooks/handlers/UpdateCounts.ts",
      ]);
    });
  });

  describe("contract metadata", () => {
    it("has correct name", () => {
      expect(UpdateCounts.name).toBe("UpdateCounts");
    });

    it("has correct event", () => {
      expect(UpdateCounts.event).toBe("SessionEnd");
    });
  });
});
