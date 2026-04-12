import { describe, expect, it } from "bun:test";
import { processExecFailed, type ResultError } from "@hooks/core/error";
import { err, ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  DEP_CONFIGS,
  ensureGitignore,
  extractWorktreePath,
  installDependencies,
  runBaselineTests,
  TEST_CONFIGS,
  type WorktreeSafetyDeps,
  WorktreeSafetyVerification,
} from "./WorktreeSafetyVerification.contract";

/** Helper to create an err Result for exec failures in test mocks. */
function execErr(cmd: string): Result<string, ResultError> {
  return err(processExecFailed(cmd, new Error(cmd)));
}

function makeDeps(overrides: Partial<WorktreeSafetyDeps> = {}): WorktreeSafetyDeps {
  return {
    ...WorktreeSafetyVerification.defaultDeps,
    execSync: () => ok(""),
    spawnSync: () => ({ status: 0 }),
    spawn: (_cmd: string, _args: string[]) => ({ unref: () => {} }),
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
    const result = WorktreeSafetyVerification.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.continue).toBe(true);
    }
  });

  it("returns continue when worktree path not found", () => {
    const input = makeInput({ tool_response: "Success", tool_input: {} });
    const deps = makeDeps();
    const result = WorktreeSafetyVerification.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.continue).toBe(true);
    }
  });

  it("returns continue when worktree path does not exist on disk", () => {
    const deps = makeDeps({ existsSync: () => false });
    const result = WorktreeSafetyVerification.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.continue).toBe(true);
    }
  });

  it("runs all three safety checks when path is valid", () => {
    const stderrLines: string[] = [];
    const spawnedCommands: string[] = [];
    const deps = makeDeps({
      stderr: (msg: string) => stderrLines.push(msg),
      spawn: (cmd: string, args: string[]) => {
        spawnedCommands.push([cmd, ...args].join(" "));
        return { unref: () => {} };
      },
      existsSync: (path: string) => {
        return path === "/tmp/test-wt" || path.endsWith("bun.lockb");
      },
      execSync: (cmd: string) => {
        if (typeof cmd === "string" && cmd.includes("rev-parse")) return ok("/tmp");
        return ok("");
      },
    });

    WorktreeSafetyVerification.execute(makeInput(), deps);

    expect(stderrLines.some((l) => l.includes("Running safety checks"))).toBe(true);
    expect(stderrLines.some((l) => l.includes("gitignore") || l.includes(".gitignore"))).toBe(true);
  });
});

describe("extractWorktreePath", () => {
  it("extracts from response text with 'at' prefix", () => {
    const input = makeInput({ tool_response: "Created worktree at /tmp/my-wt" });
    expect(extractWorktreePath(input)).toBe("/tmp/my-wt");
  });

  it("extracts from tool_input.path", () => {
    const input = makeInput({ tool_input: { path: "/tmp/test-path" }, tool_response: "" });
    expect(extractWorktreePath(input)).toBe("/tmp/test-path");
  });

  it("extracts from tool_input.worktree_path", () => {
    const input = makeInput({ tool_input: { worktree_path: "/tmp/wt-path" }, tool_response: "" });
    expect(extractWorktreePath(input)).toBe("/tmp/wt-path");
  });

  it("extracts from tool_input.worktree", () => {
    const input = makeInput({ tool_input: { worktree: "/tmp/wt" }, tool_response: "" });
    expect(extractWorktreePath(input)).toBe("/tmp/wt");
  });

  it("extracts from tool_input.directory", () => {
    const input = makeInput({ tool_input: { directory: "/tmp/dir" }, tool_response: "" });
    expect(extractWorktreePath(input)).toBe("/tmp/dir");
  });

  it("returns null when no path found", () => {
    const input = makeInput({ tool_response: "Done", tool_input: {} });
    expect(extractWorktreePath(input)).toBeNull();
  });

  it("extracts from .pait/worktrees path in response", () => {
    const input = makeInput({
      tool_response: "Created at /home/user/project/.pait/worktrees/feature-123",
      tool_input: {},
    });
    expect(extractWorktreePath(input)).toBe("/home/user/project/.pait/worktrees/feature-123");
  });

  it("extracts from backtick-quoted path in response", () => {
    const input = makeInput({
      tool_response: "Worktree available at `/tmp/my-worktree`",
      tool_input: {},
    });
    expect(extractWorktreePath(input)).toBe("/tmp/my-worktree");
  });

  it("extracts from object response with worktree_path key", () => {
    const input = makeInput({
      tool_response: { worktree_path: "/tmp/obj-wt" },
      tool_input: {},
    });
    expect(extractWorktreePath(input)).toBe("/tmp/obj-wt");
  });

  it("extracts from object response with path key", () => {
    const input = makeInput({
      tool_response: { path: "/tmp/obj-path" },
      tool_input: {},
    });
    expect(extractWorktreePath(input)).toBe("/tmp/obj-path");
  });

  it("extracts from object response with worktree key", () => {
    const input = makeInput({
      tool_response: { worktree: "/tmp/obj-worktree" },
      tool_input: {},
    });
    expect(extractWorktreePath(input)).toBe("/tmp/obj-worktree");
  });

  it("extracts from object response with directory key", () => {
    const input = makeInput({
      tool_response: { directory: "/tmp/obj-dir" },
      tool_input: {},
    });
    expect(extractWorktreePath(input)).toBe("/tmp/obj-dir");
  });

  it("returns null for object response with no matching keys", () => {
    const input = makeInput({
      tool_response: { status: "ok" },
      tool_input: {},
    });
    expect(extractWorktreePath(input)).toBeNull();
  });

  it("returns null for non-string, non-object response", () => {
    const input = makeInput({
      tool_response: 42,
      tool_input: {},
    });
    expect(extractWorktreePath(input)).toBeNull();
  });
});

describe("ensureGitignore", () => {
  it("skips when git root not found", () => {
    const stderrLines: string[] = [];
    const deps = makeDeps({
      execSync: (cmd: string) => execErr(cmd),
      stderr: (msg: string) => stderrLines.push(msg),
    });
    ensureGitignore("/tmp/test-wt", deps);
    expect(stderrLines.some((l) => l.includes("Could not find git root"))).toBe(true);
  });

  it("logs success when worktree is already in gitignore", () => {
    const stderrLines: string[] = [];
    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd.includes("rev-parse")) return ok("/tmp/project");
        if (cmd.includes("check-ignore")) return ok(""); // exit 0 = ignored
        return ok("");
      },
      stderr: (msg: string) => stderrLines.push(msg),
    });
    ensureGitignore("/tmp/project/test-wt", deps);
    expect(stderrLines.some((l) => l.includes("in .gitignore"))).toBe(true);
  });

  it("adds entry to gitignore when not ignored (exit code 1)", () => {
    let appendedContent = "";
    const stderrLines: string[] = [];
    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd.includes("rev-parse")) return ok("/tmp/project");
        if (cmd.includes("check-ignore")) {
          const cause = Object.assign(new Error("not ignored"), { status: 1 });
          return err(processExecFailed(cmd, cause));
        }
        if (cmd.includes("git add")) return ok("");
        return ok("");
      },
      appendFileSync: (_path: string, content: string) => {
        appendedContent = content;
      },
      stderr: (msg: string) => stderrLines.push(msg),
    });
    ensureGitignore("/tmp/project/test-wt", deps);
    expect(appendedContent).toContain("test-wt/");
    expect(stderrLines.some((l) => l.includes("not in .gitignore"))).toBe(true);
  });

  it("uses relative path when worktree is under git root", () => {
    let appendedContent = "";
    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd.includes("rev-parse")) return ok("/tmp/project");
        if (cmd.includes("check-ignore")) {
          const cause = Object.assign(new Error("not ignored"), { status: 1 });
          return err(processExecFailed(cmd, cause));
        }
        return ok("");
      },
      appendFileSync: (_path: string, content: string) => {
        appendedContent = content;
      },
    });
    ensureGitignore("/tmp/project/worktrees/feat", deps);
    expect(appendedContent).toContain("worktrees/feat/");
  });

  it("uses absolute path when worktree is not under git root", () => {
    let appendedContent = "";
    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd.includes("rev-parse")) return ok("/other/project");
        if (cmd.includes("check-ignore")) {
          const cause = Object.assign(new Error("not ignored"), { status: 1 });
          return err(processExecFailed(cmd, cause));
        }
        return ok("");
      },
      appendFileSync: (_path: string, content: string) => {
        appendedContent = content;
      },
    });
    ensureGitignore("/tmp/worktree-123", deps);
    expect(appendedContent).toContain("/tmp/worktree-123/");
  });

  it("logs commit failure when git commit fails", () => {
    const stderrLines: string[] = [];
    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd.includes("rev-parse")) return ok("/tmp/project");
        if (cmd.includes("check-ignore")) {
          const cause = Object.assign(new Error("not ignored"), { status: 1 });
          return err(processExecFailed(cmd, cause));
        }
        if (cmd.includes("git add")) {
          return err(processExecFailed(cmd, new Error("commit failed")));
        }
        return ok("");
      },
      stderr: (msg: string) => stderrLines.push(msg),
    });
    ensureGitignore("/tmp/project/wt", deps);
    expect(stderrLines.some((l) => l.includes("Failed to update .gitignore"))).toBe(true);
  });

  it("logs commit success when git add and commit succeed", () => {
    const stderrLines: string[] = [];
    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd.includes("rev-parse")) return ok("/tmp/project");
        if (cmd.includes("check-ignore")) {
          const cause = Object.assign(new Error("not ignored"), { status: 1 });
          return err(processExecFailed(cmd, cause));
        }
        return ok(""); // git add and commit succeed
      },
      stderr: (msg: string) => stderrLines.push(msg),
    });
    ensureGitignore("/tmp/project/wt", deps);
    expect(stderrLines.some((l) => l.includes("Added") && l.includes("committed"))).toBe(true);
  });

  it("handles unknown exit code from check-ignore", () => {
    const stderrLines: string[] = [];
    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd.includes("rev-parse")) return ok("/tmp/project");
        if (cmd.includes("check-ignore")) {
          const cause = Object.assign(new Error("unknown error"), { status: 128 });
          return err(processExecFailed(cmd, cause));
        }
        return ok("");
      },
      stderr: (msg: string) => stderrLines.push(msg),
    });
    ensureGitignore("/tmp/project/wt", deps);
    expect(stderrLines.some((l) => l.includes("git check-ignore failed"))).toBe(true);
  });
});

describe("installDependencies", () => {
  it("runs bun install for bun.lockb", () => {
    const spawned: string[] = [];
    const deps = makeDeps({
      existsSync: (path: string) => path.endsWith("bun.lockb"),
      spawn: (cmd: string, args: string[]) => {
        spawned.push([cmd, ...args].join(" "));
        return { unref: () => {} };
      },
    });
    installDependencies("/tmp/wt", deps);
    expect(spawned.some((s) => s.includes("bun install"))).toBe(true);
  });

  it("runs npm install for package-lock.json", () => {
    const spawned: string[] = [];
    const deps = makeDeps({
      existsSync: (path: string) => path.endsWith("package-lock.json"),
      spawn: (cmd: string, args: string[]) => {
        spawned.push([cmd, ...args].join(" "));
        return { unref: () => {} };
      },
    });
    installDependencies("/tmp/wt", deps);
    expect(spawned.some((s) => s.includes("npm install"))).toBe(true);
  });

  it("logs skip when no dependency manifest found", () => {
    const stderrLines: string[] = [];
    const deps = makeDeps({
      existsSync: () => false,
      stderr: (msg: string) => stderrLines.push(msg),
    });
    installDependencies("/tmp/wt", deps);
    expect(stderrLines.some((l) => l.includes("No recognized dependency manifest"))).toBe(true);
  });

  it("only installs the first matching dependency config", () => {
    let spawnCount = 0;
    const deps = makeDeps({
      existsSync: () => true, // all markers match
      spawn: () => {
        spawnCount++;
        return { unref: () => {} };
      },
    });
    installDependencies("/tmp/wt", deps);
    expect(spawnCount).toBe(1);
  });
});

describe("runBaselineTests", () => {
  it("runs bun test for bun.lockb", () => {
    const spawned: string[] = [];
    const deps = makeDeps({
      existsSync: (path: string) => path.endsWith("bun.lockb"),
      spawn: (cmd: string, args: string[]) => {
        spawned.push([cmd, ...args].join(" "));
        return { unref: () => {} };
      },
    });
    runBaselineTests("/tmp/wt", deps);
    expect(spawned.some((s) => s.includes("bun test"))).toBe(true);
  });

  it("logs skip when no test suite found", () => {
    const stderrLines: string[] = [];
    const deps = makeDeps({
      existsSync: () => false,
      stderr: (msg: string) => stderrLines.push(msg),
    });
    runBaselineTests("/tmp/wt", deps);
    expect(stderrLines.some((l) => l.includes("No recognized test suite"))).toBe(true);
  });

  it("only runs the first matching test config", () => {
    let spawnCount = 0;
    const deps = makeDeps({
      existsSync: () => true,
      spawn: () => {
        spawnCount++;
        return { unref: () => {} };
      },
    });
    runBaselineTests("/tmp/wt", deps);
    expect(spawnCount).toBe(1);
  });

  it("logs baseline test instructions", () => {
    const stderrLines: string[] = [];
    const deps = makeDeps({
      existsSync: (path: string) => path.endsWith("bun.lockb"),
      spawn: () => ({ unref: () => {} }),
      stderr: (msg: string) => stderrLines.push(msg),
    });
    runBaselineTests("/tmp/wt", deps);
    expect(stderrLines.some((l) => l.includes("baseline tests fail"))).toBe(true);
  });
});

describe("DEP_CONFIGS and TEST_CONFIGS", () => {
  it("covers all required package managers", () => {
    const markers = DEP_CONFIGS.map((c) => c.marker);
    expect(markers).toContain("bun.lockb");
    expect(markers).toContain("package.json");
    expect(markers).toContain("Cargo.toml");
    expect(markers).toContain("go.mod");
    expect(markers).toContain("requirements.txt");
  });

  it("bun.lockb has priority over package.json", () => {
    const bunIdx = DEP_CONFIGS.findIndex((c) => c.marker === "bun.lockb");
    const pkgIdx = DEP_CONFIGS.findIndex((c) => c.marker === "package.json");
    expect(bunIdx).toBeLessThan(pkgIdx);
  });

  it("TEST_CONFIGS covers main ecosystems", () => {
    const markers = TEST_CONFIGS.map((c) => c.marker);
    expect(markers).toContain("bun.lockb");
    expect(markers).toContain("Cargo.toml");
    expect(markers).toContain("go.mod");
  });
});

describe("WorktreeSafetyVerification defaultDeps", () => {
  it("defaultDeps.existsSync returns a boolean", () => {
    expect(typeof WorktreeSafetyVerification.defaultDeps.existsSync("/tmp")).toBe("boolean");
  });

  it("defaultDeps.cwd returns a string", () => {
    expect(typeof WorktreeSafetyVerification.defaultDeps.cwd()).toBe("string");
  });

  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => WorktreeSafetyVerification.defaultDeps.stderr("test")).not.toThrow();
  });

  it("defaultDeps.appendFileSync writes without throwing", () => {
    const tmpPath = `/tmp/pai-test-wtsv-append-${Date.now()}.txt`;
    expect(() =>
      WorktreeSafetyVerification.defaultDeps.appendFileSync(tmpPath, "test"),
    ).not.toThrow();
  });

  it("defaultDeps.writeFileSync writes without throwing", () => {
    const tmpPath = `/tmp/pai-test-wtsv-write-${Date.now()}.txt`;
    expect(() =>
      WorktreeSafetyVerification.defaultDeps.writeFileSync(tmpPath, "test"),
    ).not.toThrow();
  });

  it("defaultDeps.mkdirSync creates directory without throwing", () => {
    expect(() => WorktreeSafetyVerification.defaultDeps.mkdirSync("/tmp")).not.toThrow();
  });

  it("defaultDeps.execSync returns ok Result for successful command", () => {
    const result = WorktreeSafetyVerification.defaultDeps.execSync("echo hello", { timeout: 5000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.value).toBe("string");
    }
  });

  it("defaultDeps.execSync returns err Result on failed command (never throws)", () => {
    const result = WorktreeSafetyVerification.defaultDeps.execSync("false", { timeout: 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeDefined();
    }
  });

  it("defaultDeps.spawn returns object with unref", () => {
    const result = WorktreeSafetyVerification.defaultDeps.spawn("echo", ["test"], { cwd: "/tmp" });
    expect(typeof result.unref).toBe("function");
    result.unref();
  });

  it("defaultDeps.spawnSync returns object with status", () => {
    const result = WorktreeSafetyVerification.defaultDeps.spawnSync("echo", ["test"], {
      cwd: "/tmp",
    });
    expect(typeof result.status).toBe("number");
  });
});
