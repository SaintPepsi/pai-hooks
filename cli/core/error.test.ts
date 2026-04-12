/**
 * Tests for PaihError class and factory functions.
 */

import { describe, expect, it } from "bun:test";
import {
  buildFailed,
  depCycle,
  fileModified,
  hashError,
  hookNotFound,
  invalidArgs,
  lockCorrupt,
  lockMissing,
  manifestMissing,
  manifestParseError,
  manifestSchemaInvalid,
  PaihError,
  PaihErrorCode,
  settingsConflict,
  targetNotFound,
  writeFailed,
} from "@hooks/cli/core/error";

// ─── PaihError Class ───────────────────────────────────────────────────────

describe("PaihError", () => {
  it("stores code, message, and context", () => {
    const err = new PaihError(PaihErrorCode.InvalidArgs, "bad input", {
      key: "val",
    });
    expect(err.code).toBe(PaihErrorCode.InvalidArgs);
    expect(err.message).toBe("bad input");
    expect(err.context).toEqual({ key: "val" });
    expect(err.name).toBe("PaihError");
  });

  it("extends Error", () => {
    const err = new PaihError(PaihErrorCode.InvalidArgs, "test");
    expect(err).toBeInstanceOf(Error);
  });

  it("toString formats as [CODE] message", () => {
    const err = new PaihError(PaihErrorCode.BuildFailed, "oops");
    expect(err.toString()).toBe("[BUILD_FAILED] oops");
  });

  it("context is optional", () => {
    const err = new PaihError(PaihErrorCode.InvalidArgs, "no context");
    expect(err.context).toBeUndefined();
  });
});

// ─── Factory Functions ─────────────────────────────────────────────────────

describe("error factories", () => {
  it("targetNotFound", () => {
    const err = targetNotFound("/some/dir");
    expect(err.code).toBe(PaihErrorCode.TargetNotFound);
    expect(err.message).toContain("/some/dir");
    expect(err.context).toEqual({ startDir: "/some/dir" });
  });

  it("hookNotFound", () => {
    const err = hookNotFound("MyHook");
    expect(err.code).toBe(PaihErrorCode.HookNotFound);
    expect(err.message).toContain("MyHook");
    expect(err.context).toEqual({ name: "MyHook" });
  });

  it("manifestMissing", () => {
    const err = manifestMissing("/path/to/hook.json");
    expect(err.code).toBe(PaihErrorCode.ManifestMissing);
    expect(err.message).toContain("/path/to/hook.json");
  });

  it("manifestParseError includes cause", () => {
    const cause = new Error("unexpected token");
    const err = manifestParseError("/path/hook.json", cause);
    expect(err.code).toBe(PaihErrorCode.ManifestParseError);
    expect(err.message).toContain("unexpected token");
    expect(err.message).toContain("/path/hook.json");
  });

  it("manifestSchemaInvalid", () => {
    const err = manifestSchemaInvalid("/path/hook.json", "missing name field");
    expect(err.code).toBe(PaihErrorCode.ManifestSchemaInvalid);
    expect(err.message).toContain("missing name field");
  });

  it("depCycle shows cycle path", () => {
    const err = depCycle(["A", "B", "A"]);
    expect(err.code).toBe(PaihErrorCode.DepCycle);
    expect(err.message).toContain("A → B → A");
    expect(err.context).toEqual({ cyclePath: ["A", "B", "A"] });
  });

  it("invalidArgs", () => {
    const err = invalidArgs("missing required flag");
    expect(err.code).toBe(PaihErrorCode.InvalidArgs);
    expect(err.message).toBe("missing required flag");
  });

  it("buildFailed without cause", () => {
    const err = buildFailed("compilation error");
    expect(err.code).toBe(PaihErrorCode.BuildFailed);
    expect(err.message).toContain("compilation error");
  });

  it("buildFailed with cause", () => {
    const cause = new Error("ENOENT");
    const err = buildFailed("compilation error", cause);
    expect(err.message).toContain("ENOENT");
  });

  it("settingsConflict", () => {
    const err = settingsConflict("hooks.PreToolUse", "duplicate entry");
    expect(err.code).toBe(PaihErrorCode.SettingsConflict);
    expect(err.message).toContain("hooks.PreToolUse");
    expect(err.message).toContain("duplicate entry");
  });

  it("writeFailed without cause", () => {
    const err = writeFailed("/some/file.ts");
    expect(err.code).toBe(PaihErrorCode.WriteFailed);
    expect(err.message).toContain("/some/file.ts");
  });

  it("writeFailed with cause", () => {
    const cause = new Error("EACCES");
    const err = writeFailed("/some/file.ts", cause);
    expect(err.message).toContain("EACCES");
  });

  it("lockCorrupt", () => {
    const err = lockCorrupt("/path/paih.lock.json");
    expect(err.code).toBe(PaihErrorCode.LockCorrupt);
    expect(err.message).toContain("/path/paih.lock.json");
  });

  it("lockMissing references correct path", () => {
    const err = lockMissing("/project/.claude");
    expect(err.code).toBe(PaihErrorCode.LockMissing);
    expect(err.message).toContain("/project/.claude/hooks/pai-hooks/paih.lock.json");
  });

  it("fileModified", () => {
    const err = fileModified("/project/.claude/hooks/pai-hooks/MyHook/MyHook.hook.ts");
    expect(err.code).toBe(PaihErrorCode.FileModified);
    expect(err.message).toContain("--force");
  });

  it("hashError without cause", () => {
    const err = hashError("/some/file.ts");
    expect(err.code).toBe(PaihErrorCode.HashError);
    expect(err.message).toContain("/some/file.ts");
  });

  it("hashError with cause", () => {
    const err = hashError("/some/file.ts", "file not readable");
    expect(err.message).toContain("file not readable");
  });
});
