/**
 * Tests for core/adapters/yaml.ts — safe YAML parsing.
 */

import { describe, expect, it } from "bun:test";
import { safeParseYaml } from "@hooks/core/adapters/yaml";

describe("safeParseYaml", () => {
  it("parses valid YAML", () => {
    const result = safeParseYaml("name: hello\ncount: 42");
    expect(result).toEqual({ name: "hello", count: 42 });
  });

  it("parses YAML arrays", () => {
    const result = safeParseYaml("- one\n- two\n- three");
    expect(result).toEqual(["one", "two", "three"]);
  });

  it("returns null for invalid YAML", () => {
    expect(safeParseYaml("{{{{invalid: yaml: [[[")).toBeNull();
  });

  it("parses empty string as null", () => {
    expect(safeParseYaml("")).toBeNull();
  });

  it("calls onError with Error when YAML is invalid", () => {
    const errors: Error[] = [];
    safeParseYaml("{{{{invalid", (err) => errors.push(err));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
  });

  it("does not call onError when YAML is valid", () => {
    let called = false;
    safeParseYaml("name: hello", () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  it("returns null without throwing when YAML is invalid and stderr is omitted", () => {
    expect(safeParseYaml("{{{{invalid")).toBeNull();
  });
});
