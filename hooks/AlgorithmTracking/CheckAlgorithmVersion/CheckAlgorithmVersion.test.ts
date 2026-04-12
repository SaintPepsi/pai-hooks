import { describe, expect, test } from "bun:test";
import { ok } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import {
  CheckAlgorithmVersion,
  type CheckAlgorithmVersionDeps,
  isNewer,
} from "./CheckAlgorithmVersion.contract";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const baseInput: SessionStartInput = {
  session_id: "test-session-123",
};

function makeDeps(overrides: Partial<CheckAlgorithmVersionDeps> = {}): CheckAlgorithmVersionDeps {
  return {
    getLocalVersion: () => "v3.5.0",
    getUpstreamVersion: async () => ok("v3.5.0"),
    writeStateFile: () => {},
    isSubagent: () => false,
    stderr: () => {},
    homeDir: "/mock/home",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CheckAlgorithmVersion", () => {
  describe("contract metadata", () => {
    test("name is CheckAlgorithmVersion", () => {
      expect(CheckAlgorithmVersion.name).toBe("CheckAlgorithmVersion");
    });

    test("event is SessionStart", () => {
      expect(CheckAlgorithmVersion.event).toBe("SessionStart");
    });
  });

  describe("accepts", () => {
    test("accepts all SessionStart inputs", () => {
      expect(CheckAlgorithmVersion.accepts(baseInput)).toBe(true);
    });

    test("accepts input with empty session_id", () => {
      expect(CheckAlgorithmVersion.accepts({ session_id: "" })).toBe(true);
    });
  });

  describe("execute — subagent detection", () => {
    test("returns silent immediately when isSubagent is true", async () => {
      const deps = makeDeps({ isSubagent: () => true });
      const result = await CheckAlgorithmVersion.execute(baseInput, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({});
    });

    test("does not call getLocalVersion when isSubagent", async () => {
      let localCalled = false;
      const deps = makeDeps({
        isSubagent: () => true,
        getLocalVersion: () => {
          localCalled = true;
          return "v1.0.0";
        },
      });
      await CheckAlgorithmVersion.execute(baseInput, deps);
      expect(localCalled).toBe(false);
    });

    test("does not call writeStateFile when isSubagent", async () => {
      let writeCalled = false;
      const deps = makeDeps({
        isSubagent: () => true,
        writeStateFile: () => {
          writeCalled = true;
        },
      });
      await CheckAlgorithmVersion.execute(baseInput, deps);
      expect(writeCalled).toBe(false);
    });
  });

  describe("execute — update available", () => {
    test("writes available=true when upstream is newer", async () => {
      let stateData: Record<string, unknown> = {};
      const deps = makeDeps({
        getLocalVersion: () => "v3.4.0",
        getUpstreamVersion: async () => ok("v3.5.0"),
        writeStateFile: (data) => {
          stateData = data;
        },
      });
      await CheckAlgorithmVersion.execute(baseInput, deps);
      expect(stateData.available).toBe(true);
      expect(stateData.local).toBe("v3.4.0");
      expect(stateData.upstream).toBe("v3.5.0");
      expect(stateData.checkedAt).toBeDefined();
    });

    test("returns silent even when update is available", async () => {
      const deps = makeDeps({
        getLocalVersion: () => "v3.4.0",
        getUpstreamVersion: async () => ok("v3.5.0"),
      });
      const result = await CheckAlgorithmVersion.execute(baseInput, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({});
    });
  });

  describe("execute — no update available", () => {
    test("writes available=false when versions are equal", async () => {
      let stateData: Record<string, unknown> = {};
      const deps = makeDeps({
        getLocalVersion: () => "v3.5.0",
        getUpstreamVersion: async () => ok("v3.5.0"),
        writeStateFile: (data) => {
          stateData = data;
        },
      });
      await CheckAlgorithmVersion.execute(baseInput, deps);
      expect(stateData.available).toBe(false);
      expect(stateData.checkedAt).toBeDefined();
    });

    test("writes available=false when local is newer", async () => {
      let stateData: Record<string, unknown> = {};
      const deps = makeDeps({
        getLocalVersion: () => "v4.0.0",
        getUpstreamVersion: async () => ok("v3.5.0"),
        writeStateFile: (data) => {
          stateData = data;
        },
      });
      await CheckAlgorithmVersion.execute(baseInput, deps);
      expect(stateData.available).toBe(false);
    });
  });

  describe("execute — unknown versions", () => {
    test("writes available=false when local version is unknown", async () => {
      let stateData: Record<string, unknown> = {};
      const deps = makeDeps({
        getLocalVersion: () => "unknown",
        getUpstreamVersion: async () => ok("v3.5.0"),
        writeStateFile: (data) => {
          stateData = data;
        },
      });
      await CheckAlgorithmVersion.execute(baseInput, deps);
      expect(stateData.available).toBe(false);
    });

    test("writes available=false when upstream version is unknown", async () => {
      let stateData: Record<string, unknown> = {};
      const deps = makeDeps({
        getLocalVersion: () => "v3.5.0",
        getUpstreamVersion: async () => ok("unknown"),
        writeStateFile: (data) => {
          stateData = data;
        },
      });
      await CheckAlgorithmVersion.execute(baseInput, deps);
      expect(stateData.available).toBe(false);
    });

    test("writes available=false when both versions are unknown", async () => {
      let stateData: Record<string, unknown> = {};
      const deps = makeDeps({
        getLocalVersion: () => "unknown",
        getUpstreamVersion: async () => ok("unknown"),
        writeStateFile: (data) => {
          stateData = data;
        },
      });
      await CheckAlgorithmVersion.execute(baseInput, deps);
      expect(stateData.available).toBe(false);
    });
  });
});

// ─── isNewer pure function tests ──────────────────────────────────────────────

describe("isNewer", () => {
  describe("major version comparisons", () => {
    test("returns true when upstream major is greater", () => {
      expect(isNewer("v4.0.0", "v3.5.0")).toBe(true);
    });

    test("returns false when upstream major is less", () => {
      expect(isNewer("v2.0.0", "v3.0.0")).toBe(false);
    });
  });

  describe("minor version comparisons", () => {
    test("returns true when upstream minor is greater with same major", () => {
      expect(isNewer("v3.6.0", "v3.5.0")).toBe(true);
    });

    test("returns false when upstream minor is less with same major", () => {
      expect(isNewer("v3.4.0", "v3.5.0")).toBe(false);
    });
  });

  describe("patch version comparisons", () => {
    test("returns true when upstream patch is greater", () => {
      expect(isNewer("v3.5.1", "v3.5.0")).toBe(true);
    });

    test("returns false when upstream patch is less", () => {
      expect(isNewer("v3.5.0", "v3.5.1")).toBe(false);
    });

    test("returns false when versions are equal", () => {
      expect(isNewer("v3.5.0", "v3.5.0")).toBe(false);
    });
  });

  describe("version format handling", () => {
    test("handles versions without v prefix", () => {
      expect(isNewer("4.0.0", "3.5.0")).toBe(true);
    });

    test("returns false for invalid upstream format", () => {
      expect(isNewer("not-a-version", "v3.5.0")).toBe(false);
    });

    test("returns false for invalid local format", () => {
      expect(isNewer("v3.5.0", "not-a-version")).toBe(false);
    });

    test("returns false when both versions are invalid", () => {
      expect(isNewer("foo", "bar")).toBe(false);
    });
  });
});
