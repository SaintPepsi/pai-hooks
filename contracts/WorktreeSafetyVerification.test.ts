import { describe, it, expect } from "bun:test";
import {
  WorktreeSafetyVerification,
  extractWorktreePath,
  ensureGitignore,
  installDependencies,
  runBaselineTests,
  DEP_CONFIGS,
  TEST_CONFIGS,
  type WorktreeSafetyDeps,
} from "./WorktreeSafetyVerification";
import type { ToolHookInput } from "../core/types/hook-inputs";
import { join } from "path";

function makeDeps(overrides: Partial<WorktreeSafetyDeps> = {}): WorktreeSafetyDeps {
  return {
    ...WorktreeSafetyVerification.defaultDeps,
    execSync: (() => "") as any,
    spawnSync: (() => ({ status: 0 })) as any,
    spawn: ((cmd: string, args: string[]) => ({ unref: () => {} })) as any,
    existsSync: () => true,
    appendFileSync: () => {},
    writeFileSync: () => {},
    mkdirSync: () => {},
    stderr: () => {},
    cwd: () => "/tmp/test",
    ...overrides,
  };
}

function makeInput(overrides: Partial<ToolHookInput> = {}): ToolHookInput {
  return {
    session_id: "test",
    tool_name: "EnterWorktree",
    tool_input: {},
    tool_response: "Created worktree at /tmp/test-wt",
    ...overrides,
  };
}

describe("WorktreeSafetyVerification contract", () => {
  it("has correct name and event", () => {
    expect(WorktreeSafetyVerification.name).toBe("WorktreeSafetyVerification");
    expect(WorktreeSafetyVerification.event).toBe("PostToolUse");
  });

  it("accepts EnterWorktree events", () => {
    expect(WorktreeSafetyVerification.accepts(makeInput())).toBe(true);
  });

  it("rejects non-EnterWorktree events", () => {
    expect(WorktreeSafetyVerification.accepts(makeInput({ tool_name: "Read" }))).toBe(false);
  });

  it("returns continue output (never blocks)", () => {
    const deps = makeDeps();
    const result = WorktreeSafetyVerification.execute(makeInput(), deps) as any;
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("continue");
    expect(result.value.continue).toBe(true);
  });

  it("returns continue when worktree path not found", () => {
    const input = makeInput({ tool_response: "Success", tool_input: {} });
    const deps = makeDeps();
    const result = WorktreeSafetyVerification.execute(input, deps) as any;
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("continue");
  });

  it("returns continue when worktree path does not exist on disk", () => {
    const deps = makeDeps({ existsSync: () => false });
    const result = WorktreeSafetyVerification.execute(makeInput(), deps) as any;
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("continue");
  });

  it("runs all three safety checks when path is valid", () => {
    const stderrLines: string[] = [];
    const spawnedCommands: string[] = [];
    const deps = makeDeps({
      stderr: (msg: string) => stderrLines.push(msg),
      spawn: ((cmd: string, args: string[]) => {
        spawnedCommands.push([cmd, ...args].join(" "));
        return { unref: () => {} };
      }) as any,
      existsSync: (path: string) => {
        // The worktree path exists, and bun.lockb exists in it
        return path === "/tmp/test-wt" || path.endsWith("bun.lockb");
      },
      execSync: ((cmd: string) => {
        if (cmd.includes("rev-parse")) return "/tmp";
        return "";
      }) as any,
    });

    WorktreeSafetyVerification.execute(makeInput(), deps);

    expect(stderrLines.some(l => l.includes("Running safety checks"))).toBe(true);
    expect(stderrLines.some(l => l.includes("gitignore") || l.includes(".gitignore"))).toBe(true);
  });
});

describe("extractWorktreePath", () => {
  it("extracts from response text", () => {
    const input = makeInput({ tool_response: "Created worktree at /tmp/my-wt" });
    expect(extractWorktreePath(input)).toBe("/tmp/my-wt");
  });

  it("extracts from tool_input.path", () => {
    const input = makeInput({ tool_input: { path: "/tmp/test-path" }, tool_response: "" });
    expect(extractWorktreePath(input)).toBe("/tmp/test-path");
  });

  it("returns null when no path found", () => {
    const input = makeInput({ tool_response: "Done", tool_input: {} });
    expect(extractWorktreePath(input)).toBeNull();
  });
});

describe("DEP_CONFIGS and TEST_CONFIGS", () => {
  it("covers all required package managers", () => {
    const markers = DEP_CONFIGS.map(c => c.marker);
    expect(markers).toContain("bun.lockb");
    expect(markers).toContain("package.json");
    expect(markers).toContain("Cargo.toml");
    expect(markers).toContain("go.mod");
    expect(markers).toContain("requirements.txt");
  });

  it("bun.lockb has priority over package.json", () => {
    const bunIdx = DEP_CONFIGS.findIndex(c => c.marker === "bun.lockb");
    const pkgIdx = DEP_CONFIGS.findIndex(c => c.marker === "package.json");
    expect(bunIdx).toBeLessThan(pkgIdx);
  });

  it("TEST_CONFIGS covers main ecosystems", () => {
    const markers = TEST_CONFIGS.map(c => c.marker);
    expect(markers).toContain("bun.lockb");
    expect(markers).toContain("Cargo.toml");
    expect(markers).toContain("go.mod");
  });
});
