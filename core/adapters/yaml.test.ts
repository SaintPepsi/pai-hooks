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

  it("calls stderr once when YAML is invalid and stderr is provided", () => {
    const spy = { calls: 0, lastMsg: "" };
    const stderr = (msg: string) => {
      spy.calls++;
      spy.lastMsg = msg;
    };
    safeParseYaml("{{{{invalid", stderr);
    expect(spy.calls).toBe(1);
    expect(spy.lastMsg).toContain("[safeParseYaml] parse failed:");
  });

  it("does not call stderr when YAML is valid and stderr is provided", () => {
    let called = false;
    const stderr = () => { called = true; };
    safeParseYaml("name: hello", stderr);
    expect(called).toBe(false);
  });

  it("returns null without throwing when YAML is invalid and stderr is omitted", () => {
    expect(safeParseYaml("{{{{invalid")).toBeNull();
  });
});
