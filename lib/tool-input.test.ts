import { describe, expect, test } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getFilePath, getWriteContent } from "@hooks/lib/tool-input";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeInput(toolInput: unknown): ToolHookInput {
  return {
    tool_name: "Write",
    tool_input: toolInput,
  } as ToolHookInput;
}

// ─── getFilePath ────────────────────────────────────────────────────────────

describe("getFilePath", () => {
  test("extracts file_path from valid tool_input", () => {
    const input = makeInput({ file_path: "/src/foo.ts" });
    expect(getFilePath(input)).toBe("/src/foo.ts");
  });

  test("returns null when tool_input is null", () => {
    const input = makeInput(null);
    expect(getFilePath(input)).toBeNull();
  });

  test("returns null when tool_input is not an object", () => {
    const input = makeInput("string");
    expect(getFilePath(input)).toBeNull();
  });

  test("returns null when file_path is missing", () => {
    const input = makeInput({ content: "hello" });
    expect(getFilePath(input)).toBeNull();
  });
});

// ─── getWriteContent ────────────────────────────────────────────────────────

describe("getWriteContent", () => {
  test("extracts content from valid tool_input", () => {
    const input = makeInput({ content: "const x = 1;" });
    expect(getWriteContent(input)).toBe("const x = 1;");
  });

  test("returns null when tool_input is null", () => {
    const input = makeInput(null);
    expect(getWriteContent(input)).toBeNull();
  });

  test("returns null when tool_input is not an object", () => {
    const input = makeInput(42);
    expect(getWriteContent(input)).toBeNull();
  });

  test("returns null when content is missing", () => {
    const input = makeInput({ file_path: "/src/foo.ts" });
    expect(getWriteContent(input)).toBeNull();
  });
});
