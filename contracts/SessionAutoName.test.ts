import { describe, it, expect } from "bun:test";
import {
  SessionAutoName,
  sanitizePromptForNaming,
  extractFallbackName,
  isNameRelevantToPrompt,
  type SessionAutoNameDeps,
} from "@hooks/contracts/SessionAutoName";
import type { UserPromptSubmitInput } from "@hooks/core/types/hook-inputs";
import { ok, err } from "@hooks/core/result";
import { PaiError, ErrorCode } from "@hooks/core/error";

function makeDeps(overrides: Partial<SessionAutoNameDeps> = {}): SessionAutoNameDeps {
  return {
    fileExists: () => false,
    readJson: <T>(_path: string) => err<T, PaiError>(new PaiError(ErrorCode.FileNotFound, "not found")),
    writeFile: () => ok(undefined),
    ensureDir: () => ok(undefined),
    inference: async () => ({ success: true, output: "Test Session", latencyMs: 0, level: "fast" as const }),
    getCustomTitle: () => null,
    spawnSync: () => ({ stdout: { toString: () => "" } }),
    baseDir: "/tmp/test-pai",
    stderr: () => {},
    ...overrides,
  };
}

function makeInput(prompt: string, sessionId = "test-session-123"): UserPromptSubmitInput {
  return {
    session_id: sessionId,
    prompt,
  };
}

describe("SessionAutoName", () => {
  it("has correct name and event", () => {
    expect(SessionAutoName.name).toBe("SessionAutoName");
    expect(SessionAutoName.event).toBe("UserPromptSubmit");
  });

  it("accepts input with session_id", () => {
    expect(SessionAutoName.accepts(makeInput("hello"))).toBe(true);
  });

  it("rejects input without session_id", () => {
    expect(SessionAutoName.accepts(makeInput("hello", ""))).toBe(false);
  });

  it("returns silent output on empty prompt", async () => {
    const deps = makeDeps();
    const result = await SessionAutoName.execute(makeInput(""), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("silent");
    }
  });

  it("generates name via inference for new session", async () => {
    let writtenPath = "";
    let writtenContent = "";
    const deps = makeDeps({
      inference: async () => ({ success: true, output: "Dashboard Redesign", latencyMs: 0, level: "fast" as const }),
      writeFile: (path: string, content: string) => {
        if (path.endsWith("session-names.json")) {
          writtenPath = path;
          writtenContent = content;
        }
        return ok(undefined);
      },
    });

    const result = await SessionAutoName.execute(makeInput("Let's redesign the dashboard"), deps);
    expect(result.ok).toBe(true);
    expect(writtenPath).toContain("session-names.json");
    expect(writtenContent).toContain("Dashboard Redesign");
  });

  it("skips if session already has a name", async () => {
    let inferCalled = false;
    const deps = makeDeps({
      readJson: <T>(_path: string) => {
        if (_path.endsWith("session-names.json")) {
          return ok({ "test-session-123": "Existing Name" } as T);
        }
        return err<T, PaiError>(new PaiError(ErrorCode.FileNotFound, "not found"));
      },
      inference: async () => {
        inferCalled = true;
        return { success: true, output: "New Name", latencyMs: 0, level: "fast" as const };
      },
    });

    const result = await SessionAutoName.execute(makeInput("do something new"), deps);
    expect(result.ok).toBe(true);
    expect(inferCalled).toBe(false);
  });

  it("syncs custom title from /rename", async () => {
    let storedName = "";
    const deps = makeDeps({
      readJson: <T>(_path: string) => ok({} as T),
      getCustomTitle: () => "My Custom Title",
      writeFile: (path: string, content: string) => {
        if (path.endsWith("session-names.json")) {
          storedName = content;
        }
        return ok(undefined);
      },
    });

    const result = await SessionAutoName.execute(makeInput("anything"), deps);
    expect(result.ok).toBe(true);
    expect(storedName).toContain("My Custom Title");
  });

  it("falls back to extractFallbackName when inference fails", async () => {
    let storedName = "";
    const deps = makeDeps({
      inference: async () => ({ success: false, output: "", latencyMs: 0, level: "fast" as const }),
      writeFile: (path: string, content: string) => {
        if (path.endsWith("session-names.json")) {
          storedName = content;
        }
        return ok(undefined);
      },
    });

    const result = await SessionAutoName.execute(makeInput("implement authentication middleware"), deps);
    expect(result.ok).toBe(true);
    expect(storedName).toContain("Session");
  });

  it("falls back when inference throws", async () => {
    let storedName = "";
    const deps = makeDeps({
      inference: async () => { throw new Error("network error"); },
      writeFile: (path: string, content: string) => {
        if (path.endsWith("session-names.json")) {
          storedName = content;
        }
        return ok(undefined);
      },
    });

    const result = await SessionAutoName.execute(makeInput("refactor database migrations"), deps);
    expect(result.ok).toBe(true);
    expect(storedName).toContain("Session");
  });

  it("rejects single-word inference names", async () => {
    let storedName = "";
    const deps = makeDeps({
      inference: async () => ({ success: true, output: "Dashboard", latencyMs: 0, level: "fast" as const }),
      writeFile: (path: string, content: string) => {
        if (path.endsWith("session-names.json")) {
          storedName = content;
        }
        return ok(undefined);
      },
    });

    await SessionAutoName.execute(makeInput("work on the dashboard layout"), deps);
    expect(storedName).toContain("Session");
  });

  it("rejects names with short words", async () => {
    let storedName = "";
    const deps = makeDeps({
      inference: async () => ({ success: true, output: "AI ML Ops", latencyMs: 0, level: "fast" as const }),
      writeFile: (path: string, content: string) => {
        if (path.endsWith("session-names.json")) {
          storedName = content;
        }
        return ok(undefined);
      },
    });

    await SessionAutoName.execute(makeInput("setup machine learning operations"), deps);
    expect(storedName).toContain("Session");
  });
});

describe("sanitizePromptForNaming", () => {
  it("strips XML tags but keeps inner text", () => {
    expect(sanitizePromptForNaming("hello <system-reminder>noise</system-reminder> world")).toBe("hello noise world");
  });

  it("strips UUIDs", () => {
    expect(sanitizePromptForNaming("session a1b2c3d4-e5f6-7890-abcd-ef1234567890 here")).toBe("session here");
  });

  it("strips hex hashes", () => {
    expect(sanitizePromptForNaming("commit abc1234def done")).toBe("commit done");
  });

  it("strips file paths", () => {
    expect(sanitizePromptForNaming("edit /Users/hogers/Projects/foo.ts please")).toBe("edit please");
  });

  it("collapses whitespace", () => {
    expect(sanitizePromptForNaming("lots   of    spaces")).toBe("lots of spaces");
  });
});

describe("extractFallbackName", () => {
  it("extracts first substantial word as fallback", () => {
    expect(extractFallbackName("implement authentication middleware")).toBe("Implement Session");
  });

  it("returns null for all noise words", () => {
    expect(extractFallbackName("the a this that")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractFallbackName("")).toBeNull();
  });

  it("skips words shorter than 4 chars", () => {
    expect(extractFallbackName("do it now the")).toBeNull();
  });

  it("capitalizes first word", () => {
    const result = extractFallbackName("refactor everything");
    expect(result).toBe("Refactor Session");
  });
});

describe("isNameRelevantToPrompt", () => {
  it("returns true when name words appear in prompt", () => {
    expect(isNameRelevantToPrompt("Dashboard Redesign", "let's redesign the dashboard")).toBe(true);
  });

  it("returns true for partial match via prefix", () => {
    // "authentication" prefix at 60% = "authenti" (8 chars), prompt contains "authenticat"
    expect(isNameRelevantToPrompt("Authentication Setup", "authenticat the system")).toBe(true);
  });

  it("returns false when name is unrelated", () => {
    expect(isNameRelevantToPrompt("Kubernetes Deployment", "fix the login button color")).toBe(false);
  });

  it("returns true for empty name words (all noise)", () => {
    expect(isNameRelevantToPrompt("The New", "anything at all")).toBe(true);
  });
});
