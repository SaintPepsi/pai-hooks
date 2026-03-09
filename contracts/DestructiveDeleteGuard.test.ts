import { describe, test, expect } from "bun:test";
import { DestructiveDeleteGuard } from "@hooks/contracts/DestructiveDeleteGuard";
import type { DestructiveDeleteGuardDeps } from "@hooks/contracts/DestructiveDeleteGuard";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const mockDeps: DestructiveDeleteGuardDeps = {
  stderr: () => {},
};

function bashInput(command: string): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: "Bash",
    tool_input: { command },
  };
}

function editInput(newString: string): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: "Edit",
    tool_input: {
      file_path: "/some/file.ts",
      old_string: "old code",
      new_string: newString,
    },
  };
}

function writeInput(content: string): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: "Write",
    tool_input: {
      file_path: "/some/file.ts",
      content,
    },
  };
}

// ─── accepts() ────────────────────────────────────────────────────────────────

describe("DestructiveDeleteGuard accepts", () => {
  test("accepts Bash tool", () => {
    expect(DestructiveDeleteGuard.accepts(bashInput("rm -rf /tmp/foo"))).toBe(true);
  });

  test("accepts Edit tool", () => {
    expect(DestructiveDeleteGuard.accepts(editInput("rm -rf /tmp"))).toBe(true);
  });

  test("accepts Write tool", () => {
    expect(DestructiveDeleteGuard.accepts(writeInput("rm -rf /tmp"))).toBe(true);
  });

  test("rejects Read tool", () => {
    const input: ToolHookInput = {
      session_id: "test",
      tool_name: "Read",
      tool_input: { file_path: "/some/file" },
    };
    expect(DestructiveDeleteGuard.accepts(input)).toBe(false);
  });

  test("rejects Glob tool", () => {
    const input: ToolHookInput = {
      session_id: "test",
      tool_name: "Glob",
      tool_input: { pattern: "**/*.ts" },
    };
    expect(DestructiveDeleteGuard.accepts(input)).toBe(false);
  });
});

// ─── Bash: Detection ──────────────────────────────────────────────────────────

describe("DestructiveDeleteGuard Bash detection", () => {
  test("detects rm -rf (basic form)", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -rf /tmp/sessions"), mockDeps);
    expect(result.ok && result.value.type).toBe("block");
  });

  test("detects rm -r -f (split flags)", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -r -f /tmp/sessions"), mockDeps);
    expect(result.ok && result.value.type).toBe("block");
  });

  test("detects rm -fr (reversed combined flags)", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -fr /tmp/sessions"), mockDeps);
    expect(result.ok && result.value.type).toBe("block");
  });

  test("detects rm --recursive --force", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm --recursive --force /tmp/foo"), mockDeps);
    expect(result.ok && result.value.type).toBe("block");
  });

  test("detects rm --force --recursive", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm --force --recursive /tmp/foo"), mockDeps);
    expect(result.ok && result.value.type).toBe("block");
  });

  test("detects rm -rf in piped command", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("find . -name '*.tmp' | xargs rm -rf"), mockDeps);
    expect(result.ok && result.value.type).toBe("block");
  });

  test("detects rm -rf after && chain", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("cd /tmp && rm -rf sessions"), mockDeps);
    expect(result.ok && result.value.type).toBe("block");
  });

  test("returns block decision with command details", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -rf /tmp/build"), mockDeps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("block");
      if (result.value.type === "block") {
        expect(result.value.decision).toBe("block");
        expect(result.value.reason).toContain("Recursive");
      }
    }
  });
});

// ─── Bash: Allowed Commands ───────────────────────────────────────────────────

describe("DestructiveDeleteGuard Bash allowed", () => {
  test("allows single file rm (no recursive flag)", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm /tmp/file.txt"), mockDeps);
    expect(result.ok && result.value.type).toBe("continue");
  });

  test("allows rm -f single file (force but not recursive)", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -f /tmp/file.txt"), mockDeps);
    expect(result.ok && result.value.type).toBe("continue");
  });

  test("allows non-rm commands", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("ls -la /tmp"), mockDeps);
    expect(result.ok && result.value.type).toBe("continue");
  });

  test("allows grep with -r flag (not rm)", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("grep -rf pattern /tmp"), mockDeps);
    expect(result.ok && result.value.type).toBe("continue");
  });
});

// ─── Edit/Write: Code Pattern Detection ───────────────────────────────────────

describe("DestructiveDeleteGuard Edit/Write detection", () => {
  test("detects rm -rf string literal in code", () => {
    const code = 'execSync("rm -rf /tmp/sessions");';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok && result.value.type).toBe("block");
  });

  test("detects spawn array with rm and -rf", () => {
    const code = 'Bun.spawnSync(["rm", "-rf", join(TEST_DIR, "sessions")]);';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok && result.value.type).toBe("block");
  });

  test("detects spawn array with single-quoted rm -rf", () => {
    const code = "child_process.execSync('rm -rf ' + dir);";
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok && result.value.type).toBe("block");
  });

  test("detects spawn array with split -r -f flags", () => {
    const code = 'Bun.spawnSync(["rm", "-r", "-f", path]);';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok && result.value.type).toBe("block");
  });

  test("detects rm -rf in template literal", () => {
    const code = "exec(`rm -rf ${dir}`);";
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok && result.value.type).toBe("block");
  });

  test("detects rm -rf in Write tool content", () => {
    const code = '#!/bin/bash\nrm -rf /tmp/build\necho "done"';
    const result = DestructiveDeleteGuard.execute(writeInput(code), mockDeps);
    expect(result.ok && result.value.type).toBe("block");
  });

  test("returns block with guidance message", () => {
    const code = 'Bun.spawnSync(["rm", "-rf", path]);';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "block") {
      expect(result.value.reason).toContain("recursive");
    }
  });
});

// ─── Edit/Write: Allowed Content ──────────────────────────────────────────────

describe("DestructiveDeleteGuard Edit/Write allowed", () => {
  test("allows code with unlinkFile (single file delete)", () => {
    const code = "if (fileExists(path)) unlinkFile(path);";
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok && result.value.type).toBe("continue");
  });

  test("allows code mentioning rm without -rf flags", () => {
    const code = "// removed the old config\nconst removed = items.filter(x => !x);";
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok && result.value.type).toBe("continue");
  });

  test("allows removeDir adapter usage", () => {
    const code = 'removeDir(join(TEST_DIR, "sessions"));';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok && result.value.type).toBe("continue");
  });

  test("allows normal Write content without rm patterns", () => {
    const code = "export function greet(name: string): string {\n  return `Hello, ${name}`;\n}";
    const result = DestructiveDeleteGuard.execute(writeInput(code), mockDeps);
    expect(result.ok && result.value.type).toBe("continue");
  });
});
