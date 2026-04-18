import { describe, expect, test } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  getPreToolUseAskReason,
  getPreToolUseDenyReason,
  isPreToolUseAsk,
  isPreToolUseDeny,
} from "@hooks/hooks/CodingStandards/test-helpers";
import type { DestructiveDeleteGuardDeps } from "@hooks/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.contract";
import { DestructiveDeleteGuard } from "@hooks/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.contract";

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

function editInput(newString: string, filePath = "/some/file.ts"): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: "Edit",
    tool_input: {
      file_path: filePath,
      old_string: "old code",
      new_string: newString,
    },
  };
}

function writeInput(content: string, filePath = "/some/file.ts"): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: "Write",
    tool_input: {
      file_path: filePath,
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
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects rm -r -f (split flags)", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -r -f /tmp/sessions"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects rm -fr (reversed combined flags)", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -fr /tmp/sessions"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects rm --recursive --force", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput("rm --recursive --force /tmp/foo"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects rm --force --recursive", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput("rm --force --recursive /tmp/foo"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects rm -rf in piped command", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput("find . -name '*.tmp' | xargs rm -rf"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects rm -rf after && chain", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput("cd /tmp && rm -rf sessions"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("returns deny with command details for non-artifact dirs", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput("rm -rf /home/user/Documents"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
    expect(getPreToolUseDenyReason(result.value)).toContain("Destructive");
  });
});

// ─── Bash: Artifact Directory Ask ───────────────────────────────────────────

describe("DestructiveDeleteGuard artifact directory ask", () => {
  test("returns ask for rm -rf on node_modules", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -rf node_modules"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseAsk(result.value)).toBe(true);
  });

  test("returns ask for rm -rf on playwright-report", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput("rm -rf sveltekit/playwright-report/"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseAsk(result.value)).toBe(true);
  });

  test("returns ask for rm -rf on dist", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -rf ./dist"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseAsk(result.value)).toBe(true);
  });

  test("returns ask for rm -rf on .next", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -rf /project/.next"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseAsk(result.value)).toBe(true);
  });

  test("returns ask for rm -rf on .svelte-kit", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -rf .svelte-kit"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseAsk(result.value)).toBe(true);
  });

  test("returns ask for rm -rf on coverage", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -rf coverage"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseAsk(result.value)).toBe(true);
  });

  test("returns ask for rm -rf on build after cd", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput("cd /project && rm -rf build"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseAsk(result.value)).toBe(true);
  });

  test("returns ask with reason containing the command", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -rf node_modules"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseAsk(result.value)).toBe(true);
    expect(getPreToolUseAskReason(result.value)).toContain("node_modules");
  });

  test("still blocks rm -rf on non-artifact dirs", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput("rm -rf /home/user/projects"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("still blocks rm -rf on root paths", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -rf /"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });
});

// ─── Bash: Allowed Commands ───────────────────────────────────────────────────

describe("DestructiveDeleteGuard Bash allowed", () => {
  test("allows single file rm (no recursive flag)", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm /tmp/file.txt"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows rm -f single file (force but not recursive)", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rm -f /tmp/file.txt"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows non-rm commands", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("ls -la /tmp"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows grep with -r flag (not rm)", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("grep -rf pattern /tmp"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows rm of multiple files with hyphens in paths", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput("rm /project/references/device-profile.md /project/references/dead-vectors.md"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows rm of files whose names contain 'r' after hyphen", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput("rm /tmp/my-report.txt /tmp/test-results.json"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows rm -f of files with hyphens in paths", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput("rm -f /project/temp-reference.md"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });
});

// ─── Edit/Write: Code Pattern Detection ───────────────────────────────────────

describe("DestructiveDeleteGuard Edit/Write detection", () => {
  test("detects rm -rf string literal in code", () => {
    const code = 'execSync("rm -rf /tmp/sessions");';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects spawn array with rm and -rf", () => {
    const code = 'Bun.spawnSync(["rm", "-rf", join(TEST_DIR, "sessions")]);';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects spawn array with single-quoted rm -rf", () => {
    const code = "child_process.execSync('rm -rf ' + dir);";
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects spawn array with split -r -f flags", () => {
    const code = 'Bun.spawnSync(["rm", "-r", "-f", path]);';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects rm -rf in template literal", () => {
    const code = "exec(`rm -rf ${dir}`);";
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects rm -rf in Write tool content", () => {
    const code = '#!/bin/bash\nrm -rf /tmp/build\necho "done"';
    const result = DestructiveDeleteGuard.execute(writeInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("returns deny with guidance message", () => {
    const code = 'Bun.spawnSync(["rm", "-rf", path]);';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
    expect(getPreToolUseDenyReason(result.value)).toContain("destructive");
  });
});

// ─── Edit/Write: Allowed Content ──────────────────────────────────────────────

describe("DestructiveDeleteGuard Edit/Write allowed", () => {
  test("allows code with unlinkFile (single file delete)", () => {
    const code = "if (fileExists(path)) unlinkFile(path);";
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows code mentioning rm without -rf flags", () => {
    const code = "// removed the old config\nconst removed = items.filter(x => !x);";
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows removeDir adapter usage", () => {
    const code = 'removeDir(join(TEST_DIR, "sessions"));';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows normal Write content without rm patterns", () => {
    const code = "export function greet(name: string): string {\n  return `Hello, ${name}`;\n}";
    const result = DestructiveDeleteGuard.execute(writeInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("returns continue for empty Edit new_string", () => {
    const input: ToolHookInput = {
      session_id: "test-session",
      tool_name: "Edit",
      tool_input: { file_path: "/some/file.ts", old_string: "old", new_string: "" },
    };
    const result = DestructiveDeleteGuard.execute(input, mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("returns continue for empty Write content", () => {
    const input: ToolHookInput = {
      session_id: "test-session",
      tool_name: "Write",
      tool_input: { file_path: "/some/file.ts", content: "" },
    };
    const result = DestructiveDeleteGuard.execute(input, mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });
});

// ─── Markdown File Exclusion ─────────────────────────────────────────────────

describe("DestructiveDeleteGuard markdown exclusion", () => {
  test("allows Write to .md file mentioning delete patterns", () => {
    const content = "Use recursive force-delete to clean the build directory.";
    const result = DestructiveDeleteGuard.execute(writeInput(content, "/docs/README.md"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows Edit to .md file mentioning delete patterns", () => {
    const content = "Confirming before destructive recursive-delete operations";
    const result = DestructiveDeleteGuard.execute(editInput(content, "/docs/hooks.md"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows Write to .mdx file mentioning delete patterns", () => {
    const content = "```bash\nrecursive force-delete node_modules\n```";
    const result = DestructiveDeleteGuard.execute(writeInput(content, "/blog/post.mdx"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("does not exempt .test.ts files from content check", () => {
    const code = ["Bun.spawnSync([", '"rm"', ",", '"-r' + 'f"', ", path]);"].join("");
    const result = DestructiveDeleteGuard.execute(writeInput(code, "/src/guard.test.ts"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("does not exempt .spec.ts files from content check", () => {
    const code = ["Bun.spawnSync([", '"rm"', ",", '"-r' + 'f"', ", dir]);"].join("");
    const result = DestructiveDeleteGuard.execute(writeInput(code, "/src/guard.spec.ts"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });
});

// ─── Dockerfile Exclusion ────────────────────────────────────────────────────

describe("DestructiveDeleteGuard Dockerfile exclusion", () => {
  test("allows Write to Dockerfile with apt cleanup", () => {
    const content = [
      "RUN apt-get update && apt-get install -y curl && r",
      "m -rf /var/lib/apt/lists/*",
    ].join("");
    const result = DestructiveDeleteGuard.execute(
      writeInput(content, "/project/Dockerfile"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows Edit to Dockerfile with cache cleanup", () => {
    const content = ["RUN pip install -r requirements.txt && r", "m -rf /root/.cache"].join("");
    const result = DestructiveDeleteGuard.execute(
      editInput(content, "/project/Dockerfile"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows Write to Dockerfile.dev variant", () => {
    const content = ["RUN r", "m -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*"].join("");
    const result = DestructiveDeleteGuard.execute(
      writeInput(content, "/project/Dockerfile.dev"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("still blocks same content in regular shell scripts", () => {
    const content = ["#!/bin/bash\nr", "m -rf /var/lib/apt/lists/*"].join("");
    const result = DestructiveDeleteGuard.execute(
      writeInput(content, "/project/cleanup.sh"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });
});

// ─── Bash: empty and string inputs ──────────────────────────────────────────

describe("DestructiveDeleteGuard Bash edge cases", () => {
  test("returns continue for empty bash command", () => {
    const result = DestructiveDeleteGuard.execute(bashInput(""), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("handles string tool_input for Bash", () => {
    const input: ToolHookInput = {
      session_id: "test-session",
      tool_name: "Bash",
      tool_input: "ls -la" as unknown as Record<string, unknown>,
    };
    const result = DestructiveDeleteGuard.execute(input, mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });
});

// ─── Bash: Non-rm Destructive Commands ───────────────────────────────────────

describe("DestructiveDeleteGuard Bash non-rm detection", () => {
  test("detects find -delete", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("find /tmp -type f -delete"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects find -exec rm", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("find /tmp -exec rm {} \\;"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects python3 shutil.rmtree", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput('python3 -c "import shutil; shutil.rmtree(\\"/tmp/foo\\")"'),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects python rmtree", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput('python -c "from shutil import rmtree; rmtree(\\"/tmp\\")"'),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects perl rmtree", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput('perl -e "use File::Path; rmtree(\\"/tmp/foo\\")"'),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects ruby FileUtils.rm_rf", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput('ruby -e "require \\"fileutils\\"; FileUtils.rm_rf(\\"/tmp\\")"'),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects bun -e rmSync", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput('bun -e "require(\\"fs\\").rmSync(\\"/tmp\\", {recursive:true})"'),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects node -e rmSync", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput('node -e "require(\\"fs\\").rmSync(\\"/tmp\\", {recursive:true})"'),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects rsync --delete", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput("rsync -a --delete /tmp/empty/ /target/"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects git clean -fd", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("git clean -fd"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects git clean -fdx", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("git clean -fdx"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects git clean -d", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("git clean -d"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });
});

// ─── Bash: Non-rm Allowed Commands ───────────────────────────────────────────

describe("DestructiveDeleteGuard Bash non-rm allowed", () => {
  test("allows find without -delete", () => {
    const result = DestructiveDeleteGuard.execute(
      bashInput("find /tmp -name '*.log' -print"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows python without rmtree", () => {
    const result = DestructiveDeleteGuard.execute(bashInput('python3 -c "print(42)"'), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows rsync without --delete", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("rsync -av /src/ /dst/"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows git clean without -d", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("git clean -f"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows bun without rmSync", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("bun test"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows git status (no clean)", () => {
    const result = DestructiveDeleteGuard.execute(bashInput("git status"), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });
});

// ─── Edit/Write: Non-rm Code Pattern Detection ──────────────────────────────

describe("DestructiveDeleteGuard Edit/Write non-rm detection", () => {
  test("detects shutil.rmtree in Python code", () => {
    const code = 'import shutil\nshutil.rmtree("/tmp/build")';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects rmtree() call in code", () => {
    const code = 'rmtree("/path/to/dir")';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects FileUtils.rm_rf in Ruby code", () => {
    const code = 'FileUtils.rm_rf("/tmp/build")';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects rmSync with recursive in Node code", () => {
    const code = "fs.rmSync(dir, { recursive: true, force: true });";
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects find -delete in shell script code", () => {
    const code = '#!/bin/bash\nfind /tmp -name "*.log" -delete';
    const result = DestructiveDeleteGuard.execute(writeInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects rsync --delete in code", () => {
    const code = 'execSync("rsync -a --delete /empty/ /target/")';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });

  test("detects git clean -fd in code", () => {
    const code = 'execSync("git clean -fd")';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isPreToolUseDeny(result.value)).toBe(true);
  });
});

// ─── Edit/Write: Non-rm Allowed Content ─────────────────────────────────────

describe("DestructiveDeleteGuard Edit/Write non-rm allowed", () => {
  test("allows rmSync without recursive", () => {
    const code = "fs.rmSync(filePath);";
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows find without -delete", () => {
    const code = 'const files = execSync("find /src -name *.ts").toString();';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows rsync without --delete", () => {
    const code = 'execSync("rsync -av /src/ /backup/")';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows git commands without clean -d", () => {
    const code = 'execSync("git status")';
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows shutil import without rmtree", () => {
    const code = "import shutil\nshutil.copy2(src, dst)";
    const result = DestructiveDeleteGuard.execute(editInput(code), mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("allows edits to core/adapters/fs.ts even with destructive patterns", () => {
    const code = "rmSync(path, { recursive: true, force: true });";
    const result = DestructiveDeleteGuard.execute(
      editInput(code, "/project/core/adapters/fs.ts"),
      mockDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  test("returns empty content for non-Edit/non-Write tools in content check path", () => {
    // Bash tool with a Bash command that contains rm -rf but NOT as a bash command pattern
    // This exercises getContentToCheck returning "" for Bash (line 187)
    // The Bash tool goes through the bash command path, not the content check path
    const input: ToolHookInput = {
      session_id: "test-session",
      tool_name: "Read",
      tool_input: { file_path: "/some/file.ts" },
    };
    const result = DestructiveDeleteGuard.execute(input, mockDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });
});
