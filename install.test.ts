import { describe, it, expect } from "bun:test";
import { mergeHooksIntoSettings, isAlreadyInstalled } from "@hooks/install";

interface MatcherGroup {
  matcher: string;
  hooks: { type: string; command: string }[];
}

describe("isAlreadyInstalled", () => {
  it("returns false when env var is not set", () => {
    const settings = { env: {} };
    expect(isAlreadyInstalled(settings, "SAINTPEPSI_PAI_HOOKS_DIR")).toBe(false);
  });

  it("returns true when env var is present", () => {
    const settings = { env: { SAINTPEPSI_PAI_HOOKS_DIR: "/some/path" } };
    expect(isAlreadyInstalled(settings, "SAINTPEPSI_PAI_HOOKS_DIR")).toBe(true);
  });
});

describe("mergeHooksIntoSettings", () => {
  it("adds env var to settings", () => {
    const settings = { env: {}, hooks: {} };
    const exported = {
      envVar: "SAINTPEPSI_PAI_HOOKS_DIR",
      hooks: {},
    };

    const result = mergeHooksIntoSettings(settings, exported, "/clone/path");
    expect(result.env.SAINTPEPSI_PAI_HOOKS_DIR).toBe("/clone/path");
  });

  it("appends hook entries to existing hooks", () => {
    const settings = {
      env: {},
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "/existing/hook.ts" }] },
        ],
      },
    };
    const exported = {
      envVar: "SAINTPEPSI_PAI_HOOKS_DIR",
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "${SAINTPEPSI_PAI_HOOKS_DIR}/CodingStandardsEnforcer.hook.ts" }],
          },
        ],
      },
    };

    const result = mergeHooksIntoSettings(settings, exported, "/clone/path");

    expect(result.hooks.PreToolUse).toHaveLength(2);
    expect(result.hooks.PreToolUse[0].hooks[0].command).toBe("/existing/hook.ts");
    expect(result.hooks.PreToolUse[1].hooks[0].command).toContain("CodingStandardsEnforcer");
  });

  it("creates hooks section if it does not exist", () => {
    const settings = { env: {} };
    const exported = {
      envVar: "SAINTPEPSI_PAI_HOOKS_DIR",
      hooks: {
        SessionStart: [
          { matcher: "*", hooks: [{ type: "command", command: "${SAINTPEPSI_PAI_HOOKS_DIR}/StartupGreeting.hook.ts" }] },
        ],
      },
    };

    const result = mergeHooksIntoSettings(settings, exported, "/clone/path");
    expect(result.hooks.SessionStart).toHaveLength(1);
  });

  it("does not duplicate entries on re-install", () => {
    const settings = {
      env: { SAINTPEPSI_PAI_HOOKS_DIR: "/old/path" },
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "${SAINTPEPSI_PAI_HOOKS_DIR}/CodingStandardsEnforcer.hook.ts" }],
          },
        ],
      },
    };
    const exported = {
      envVar: "SAINTPEPSI_PAI_HOOKS_DIR",
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "${SAINTPEPSI_PAI_HOOKS_DIR}/CodingStandardsEnforcer.hook.ts" }],
          },
        ],
      },
    };

    const result = mergeHooksIntoSettings(settings, exported, "/new/path");

    const editMatchers = result.hooks.PreToolUse.filter(
      (m: MatcherGroup) => m.matcher === "Edit"
    );
    expect(editMatchers).toHaveLength(1);
    expect(result.env.SAINTPEPSI_PAI_HOOKS_DIR).toBe("/new/path");
  });
});
