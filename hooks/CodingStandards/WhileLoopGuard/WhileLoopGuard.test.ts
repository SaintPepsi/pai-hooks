import { describe, expect, test } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { WhileLoopGuardDeps } from "@hooks/hooks/CodingStandards/WhileLoopGuard/WhileLoopGuard.contract";
import { WhileLoopGuard } from "@hooks/hooks/CodingStandards/WhileLoopGuard/WhileLoopGuard.contract";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<WhileLoopGuardDeps> = {}): WhileLoopGuardDeps {
  return {
    readFile: () => null,
    stderr: () => {},
    ...overrides,
  };
}

function makeWriteInput(filePath: string, content: string): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
  };
}

function makeEditInput(
  filePath: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: "Edit",
    tool_input: {
      file_path: filePath,
      old_string: oldString,
      new_string: newString,
      replace_all: replaceAll,
    },
  };
}

// ─── accepts() ───────────────────────────────────────────────────────────────

describe("WhileLoopGuard.accepts", () => {
  test("accepts Write to .ts file", () => {
    expect(WhileLoopGuard.accepts(makeWriteInput("src/index.ts", ""))).toBe(true);
  });

  test("accepts Edit to .tsx file", () => {
    expect(WhileLoopGuard.accepts(makeEditInput("src/App.tsx", "a", "b"))).toBe(true);
  });

  test("accepts Write to .py file", () => {
    expect(WhileLoopGuard.accepts(makeWriteInput("script.py", ""))).toBe(true);
  });

  test("accepts Write to .php file", () => {
    expect(WhileLoopGuard.accepts(makeWriteInput("index.php", ""))).toBe(true);
  });

  test("accepts Write to .go file", () => {
    expect(WhileLoopGuard.accepts(makeWriteInput("main.go", ""))).toBe(true);
  });

  test("accepts Write to .rs file", () => {
    expect(WhileLoopGuard.accepts(makeWriteInput("main.rs", ""))).toBe(true);
  });

  test("rejects non-code files", () => {
    expect(WhileLoopGuard.accepts(makeWriteInput("readme.md", ""))).toBe(false);
    expect(WhileLoopGuard.accepts(makeWriteInput("data.json", ""))).toBe(false);
    expect(WhileLoopGuard.accepts(makeWriteInput("style.css", ""))).toBe(false);
    expect(WhileLoopGuard.accepts(makeWriteInput("config.yaml", ""))).toBe(false);
  });

  test("rejects non-Write/Edit tools", () => {
    const input: ToolHookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
    };
    expect(WhileLoopGuard.accepts(input)).toBe(false);
  });

  test("rejects Read tool", () => {
    const input: ToolHookInput = {
      session_id: "test",
      tool_name: "Read",
      tool_input: { file_path: "src/index.ts" },
    };
    expect(WhileLoopGuard.accepts(input)).toBe(false);
  });
});

// ─── execute() — Write ──────────────────────────────────────────────────────

describe("WhileLoopGuard.execute — Write", () => {
  const deps = makeDeps();

  test("continues for clean code", () => {
    const input = makeWriteInput(
      "src/index.ts",
      "const x = 1;\nfor (const item of items) { process(item); }",
    );
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("blocks while loop", () => {
    const input = makeWriteInput("src/index.ts", "while (x > 0) { x--; }");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("block");
      if (result.value.type === "block") {
        expect(result.value.reason).toContain("While loops are banned");
      }
    }
  });

  test("blocks while with no space before paren", () => {
    const input = makeWriteInput("src/index.ts", "while(true) { break; }");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("block");
  });

  test("blocks do...while loop", () => {
    const input = makeWriteInput("src/index.ts", "do { x++; } while (x < 10);");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("block");
  });

  test("blocks Python while loop", () => {
    const input = makeWriteInput("script.py", "while True:\n    pass");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("block");
  });

  test("blocks Rust while loop", () => {
    const input = makeWriteInput("main.rs", "while x > 0 {\n    x -= 1;\n}");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("block");
  });

  test("continues when while is in a single-line comment", () => {
    const input = makeWriteInput("src/index.ts", "// while loops are bad\nconst x = 1;");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("continues when while is in a multi-line comment", () => {
    const input = makeWriteInput("src/index.ts", "/* while (true) { } */\nconst x = 1;");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("continues when while is in a string literal", () => {
    const input = makeWriteInput("src/index.ts", 'const msg = "wait a while";\nconst x = 1;');
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("continues when while is in a template literal", () => {
    const input = makeWriteInput("src/index.ts", "const msg = `while loop`;\nconst x = 1;");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("continues when while is in a Python # comment", () => {
    const input = makeWriteInput("script.py", "# while True:\nx = 1");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("continues for for loop", () => {
    const input = makeWriteInput("src/index.ts", "for (let i = 0; i < 10; i++) { process(i); }");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("continues for for...of loop", () => {
    const input = makeWriteInput("src/index.ts", "for (const item of items) { process(item); }");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });
});

// ─── execute() — Edit (state-check) ─────────────────────────────────────────

describe("WhileLoopGuard.execute — Edit (state-check)", () => {
  test("blocks when existing file contains while loop (state-check)", () => {
    const existingContent = "const x = 1;\nwhile (x > 0) { x--; }\nconst y = 2;";
    const deps = makeDeps({ readFile: () => existingContent });
    const input = makeEditInput("src/index.ts", "const y = 2", "const y = 3");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("block");
  });

  test("blocks when edit introduces a while loop", () => {
    const existingContent = "const x = 1;\nconst y = 2;";
    const deps = makeDeps({ readFile: () => existingContent });
    const input = makeEditInput("src/index.ts", "const y = 2", "while (true) { break; }");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("block");
  });

  test("continues when edit removes while loop", () => {
    const existingContent = "const x = 1;\nwhile (x > 0) { x--; }";
    const deps = makeDeps({ readFile: () => existingContent });
    const input = makeEditInput(
      "src/index.ts",
      "while (x > 0) { x--; }",
      "for (let i = x; i > 0; i--) { i--; }",
    );
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("continues when file has no while loops after edit", () => {
    const existingContent = "const x = 1;\nconst y = 2;";
    const deps = makeDeps({ readFile: () => existingContent });
    const input = makeEditInput("src/index.ts", "const y = 2", "const y = 3");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("handles replace_all correctly", () => {
    const existingContent = "while (a) { }\nconst x = 1;\nwhile (b) { }";
    const deps = makeDeps({ readFile: () => existingContent });
    const input = makeEditInput("src/index.ts", "while", "for", true);
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("fails open when file cannot be read (new file)", () => {
    const deps = makeDeps({ readFile: () => null });
    const input = makeEditInput("src/new-file.ts", "placeholder", "const x = 1;");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("blocks when new file content (via Edit) contains while loop", () => {
    const deps = makeDeps({ readFile: () => null });
    const input = makeEditInput("src/new-file.ts", "placeholder", "while (true) { break; }");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("block");
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("WhileLoopGuard — edge cases", () => {
  const deps = makeDeps();

  test("does not match 'meanwhile' or 'worthwhile'", () => {
    const input = makeWriteInput(
      "src/index.ts",
      "const meanwhile = true;\nconst worthwhile = false;",
    );
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("blocks while inside a function body", () => {
    const input = makeWriteInput(
      "src/index.ts",
      ["function process() {", "  let i = 0;", "  while (i < 10) {", "    i++;", "  }", "}"].join(
        "\n",
      ),
    );
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("block");
  });

  test("continues when while is only in single-quoted string", () => {
    const input = makeWriteInput("src/index.ts", "const msg = 'while we wait';");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("block reason includes file path", () => {
    const input = makeWriteInput("src/broken.ts", "while (true) {}");
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "block") {
      expect(result.value.reason).toContain("src/broken.ts");
    }
  });

  test("continues for missing tool_input fields on Edit", () => {
    const input: ToolHookInput = {
      session_id: "test",
      tool_name: "Edit",
      tool_input: { file_path: "src/index.ts" },
    };
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("continues when tool_input is null on Write", () => {
    const input: ToolHookInput = {
      session_id: "test",
      tool_name: "Write",
      tool_input: null as unknown as Record<string, unknown>,
    };
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("continues when tool_input is a string on Write", () => {
    const input: ToolHookInput = {
      session_id: "test",
      tool_name: "Write",
      tool_input: "not an object" as unknown as Record<string, unknown>,
    };
    const result = WhileLoopGuard.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });
});

describe("WhileLoopGuard defaultDeps", () => {
  test("defaultDeps.readFile returns null for missing file", () => {
    const result = WhileLoopGuard.defaultDeps.readFile("/tmp/pai-nonexistent-wlg-test.ts");
    expect(result).toBeNull();
  });

  test("defaultDeps.stderr writes without throwing", () => {
    expect(() => WhileLoopGuard.defaultDeps.stderr("test")).not.toThrow();
  });
});
