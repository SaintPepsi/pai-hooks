import { describe, expect, test } from "bun:test";
import { makeWriteInput, makeEditInput, makeToolInput } from "@hooks/lib/test-helpers";

describe("makeWriteInput", () => {
  test("returns Write input with file_path and content", () => {
    const input = makeWriteInput("/src/foo.ts", "const x = 1;");
    expect(input.tool_name).toBe("Write");
    expect((input.tool_input as Record<string, unknown>).file_path).toBe("/src/foo.ts");
    expect((input.tool_input as Record<string, unknown>).content).toBe("const x = 1;");
  });
});

describe("makeEditInput", () => {
  test("returns Edit input with file_path, old_string, new_string", () => {
    const input = makeEditInput("/src/foo.ts", "old", "new");
    expect(input.tool_name).toBe("Edit");
    expect((input.tool_input as Record<string, unknown>).old_string).toBe("old");
    expect((input.tool_input as Record<string, unknown>).new_string).toBe("new");
  });

  test("uses default old_string and new_string", () => {
    const input = makeEditInput("/src/foo.ts");
    expect((input.tool_input as Record<string, unknown>).old_string).toBe("a");
    expect((input.tool_input as Record<string, unknown>).new_string).toBe("b");
  });
});

describe("makeToolInput", () => {
  test("returns input with specified tool name", () => {
    const input = makeToolInput("Read", "/src/foo.ts");
    expect(input.tool_name).toBe("Read");
    expect((input.tool_input as Record<string, unknown>).file_path).toBe("/src/foo.ts");
  });
});
