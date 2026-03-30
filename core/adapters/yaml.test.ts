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
});
