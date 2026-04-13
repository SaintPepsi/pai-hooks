/**
 * Tests for lib/hook-config.ts — typed and untyped config reading.
 */

import { describe, expect, it } from "bun:test";
import { Schema } from "effect";
import { ErrorCode } from "@hooks/core/error";
import { readHookConfig } from "@hooks/lib/hook-config";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeReader(settings: Record<string, unknown>): (path: string) => string | null {
  return () => JSON.stringify(settings);
}

function makeFailReader(): (path: string) => string | null {
  return () => null;
}

function makeInvalidJsonReader(): (path: string) => string | null {
  return () => "not-json{{{";
}

const TestSchema = Schema.Struct({
  blocking: Schema.Boolean,
  threshold: Schema.optional(Schema.Number),
});

type TestConfig = typeof TestSchema.Type;

// ─── Untyped overload ────────────────────────────────────────────────────────

describe("readHookConfig (untyped)", () => {
  it("returns config object when present", () => {
    const reader = makeReader({
      hookConfig: { myHook: { blocking: true } },
    });
    const result = readHookConfig("myHook", reader);
    expect(result).toEqual({ blocking: true });
  });

  it("returns null when hookConfig key is missing", () => {
    const reader = makeReader({ hookConfig: {} });
    const result = readHookConfig("missingHook", reader);
    expect(result).toBeNull();
  });

  it("returns null when hookConfig is absent", () => {
    const reader = makeReader({});
    const result = readHookConfig("myHook", reader);
    expect(result).toBeNull();
  });

  it("returns null when file cannot be read", () => {
    const result = readHookConfig("myHook", makeFailReader());
    expect(result).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    const result = readHookConfig("myHook", makeInvalidJsonReader());
    expect(result).toBeNull();
  });

  it("returns null when config value is not an object", () => {
    const reader = makeReader({ hookConfig: { myHook: "a string" } });
    const result = readHookConfig("myHook", reader);
    expect(result).toBeNull();
  });

  it("passes settingsPath override to reader", () => {
    let capturedPath: string | null = null;
    const reader = (path: string): string | null => {
      capturedPath = path;
      return JSON.stringify({ hookConfig: { myHook: { val: 1 } } });
    };
    readHookConfig("myHook", reader, "/custom/path/settings.json");
    expect(capturedPath!).toBe("/custom/path/settings.json");
  });
});

// ─── Typed overload (with Schema) ────────────────────────────────────────────

describe("readHookConfig (with Schema)", () => {
  it("returns ok(config) when config is valid", () => {
    const reader = makeReader({
      hookConfig: { myHook: { blocking: true, threshold: 5 } },
    });
    const result = readHookConfig("myHook", TestSchema, reader);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blocking).toBe(true);
      expect(result.value.threshold).toBe(5);
    }
  });

  it("returns ok when optional field is absent", () => {
    const reader = makeReader({
      hookConfig: { myHook: { blocking: false } },
    });
    const result = readHookConfig("myHook", TestSchema, reader);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blocking).toBe(false);
      expect(result.value.threshold).toBeUndefined();
    }
  });

  it("returns err(ConfigValidationFailed) when config is missing", () => {
    const reader = makeReader({ hookConfig: {} });
    const result = readHookConfig("missingHook", TestSchema, reader);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.ConfigValidationFailed);
    }
  });

  it("returns err(ConfigValidationFailed) when schema validation fails", () => {
    const reader = makeReader({
      hookConfig: { myHook: { blocking: "not-a-boolean" } },
    });
    const result = readHookConfig("myHook", TestSchema, reader);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.ConfigValidationFailed);
      expect(result.error.message).toContain("myHook");
    }
  });

  it("returns err(ConfigValidationFailed) when file cannot be read", () => {
    const result = readHookConfig("myHook", TestSchema, makeFailReader());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.ConfigValidationFailed);
    }
  });

  it("returns err(ConfigValidationFailed) when JSON is invalid", () => {
    const result = readHookConfig("myHook", TestSchema, makeInvalidJsonReader());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.ConfigValidationFailed);
    }
  });

  it("passes settingsPath override to reader", () => {
    let capturedPath: string | null = null;
    const reader = (path: string): string | null => {
      capturedPath = path;
      return JSON.stringify({ hookConfig: { myHook: { blocking: true } } });
    };
    readHookConfig("myHook", TestSchema, reader, "/custom/path/settings.json");
    expect(capturedPath!).toBe("/custom/path/settings.json");
  });

  it("error message includes hookName", () => {
    const reader = makeReader({ hookConfig: { wrongHook: { blocking: true } } });
    const result = readHookConfig("myHook", TestSchema, reader);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("myHook");
    }
  });
});

// ─── Type narrowing via overload ─────────────────────────────────────────────

describe("readHookConfig overload resolution", () => {
  it("untyped overload returns T | null (not Result)", () => {
    const reader = makeReader({ hookConfig: { h: { x: 1 } } });
    const result = readHookConfig<{ x: number }>("h", reader);
    // If this were a Result, it would have an `ok` property — we check it doesn't
    expect(result).not.toHaveProperty("ok");
    expect(result).toEqual({ x: 1 });
  });

  it("typed overload returns Result (not plain object)", () => {
    const reader = makeReader({ hookConfig: { h: { blocking: true } } });
    const result = readHookConfig("h", TestSchema, reader);
    expect(result).toHaveProperty("ok");
  });
});
