import { describe, it, expect } from "bun:test";
import { GitAutoSync } from "./GitAutoSync";
import type { SessionEndInput } from "../core/types/hook-inputs";

function makeInput(): SessionEndInput {
  return { session_id: "test" };
}

describe("GitAutoSync contract", () => {
  it("has correct name and event", () => {
    expect(GitAutoSync.name).toBe("GitAutoSync");
    expect(GitAutoSync.event).toBe("SessionEnd");
  });

  it("accepts all SessionEnd inputs", () => {
    expect(GitAutoSync.accepts(makeInput())).toBe(true);
  });

  it("returns silent output", () => {
    // Provide deps that simulate no changes (empty git status)
    const deps = {
      ...GitAutoSync.defaultDeps,
      execSync: ((cmd: string) => {
        if (cmd === "git status --porcelain") return "";
        return "";
      }) as any,
      exit: () => {},
      claudeDir: "/tmp/test-git-auto-sync",
    };

    const result = GitAutoSync.execute(makeInput(), deps) as any;
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("silent");
  });

  it("execute suppresses exit calls from runGitAutoSync", () => {
    let exitCalled = false;
    const deps = {
      ...GitAutoSync.defaultDeps,
      execSync: ((cmd: string) => {
        if (cmd === "git status --porcelain") return "";
        return "";
      }) as any,
      exit: () => { exitCalled = true; },
      claudeDir: "/tmp/test-git-auto-sync",
    };

    GitAutoSync.execute(makeInput(), deps);
    // exit should NOT have been called — execute suppresses it
    expect(exitCalled).toBe(false);
  });
});
