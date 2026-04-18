import { describe, expect, it } from "bun:test";
import { safeJsonParse } from "@hooks/core/adapters/json";

describe("safeJsonParse", () => {
  it("parses valid JSON object", () => {
    const result = safeJsonParse('{"key": "value"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ key: "value" });
    }
  });

  it("parses nested JSON", () => {
    const result = safeJsonParse('{"a": {"b": [1, 2]}}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as Record<string, unknown>).a).toEqual({ b: [1, 2] });
    }
  });

  it("returns error for invalid JSON", () => {
    const result = safeJsonParse("{not valid json}");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Invalid JSON");
    }
  });

  it("returns error for empty string", () => {
    const result = safeJsonParse("");
    expect(result.ok).toBe(false);
  });

  it("parses JSON with empty object", () => {
    const result = safeJsonParse("{}");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });
});
