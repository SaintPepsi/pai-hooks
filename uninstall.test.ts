import { describe, expect, it } from "bun:test";
import { removeHooksFromSettings } from "@hooks/uninstall";

describe("removeHooksFromSettings", () => {
  it("removes env var", () => {
    const settings = {
      env: { SAINTPEPSI_PAI_HOOKS_DIR: "/path", OTHER: "value" },
      hooks: {},
    };

    const result = removeHooksFromSettings(settings, "SAINTPEPSI_PAI_HOOKS_DIR");
    expect(result.env.SAINTPEPSI_PAI_HOOKS_DIR).toBeUndefined();
    expect(result.env.OTHER).toBe("value");
  });

  it("removes hook entries containing the env var", () => {
    const settings = {
      env: { SAINTPEPSI_PAI_HOOKS_DIR: "/path" },
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [
              {
                type: "command",
                command: "${SAINTPEPSI_PAI_HOOKS_DIR}/Foo.hook.ts",
              },
            ],
          },
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "/other/hook.ts" }],
          },
        ],
      },
    };

    const result = removeHooksFromSettings(settings, "SAINTPEPSI_PAI_HOOKS_DIR");

    expect(result.hooks.PreToolUse).toHaveLength(1);
    expect(result.hooks.PreToolUse[0].matcher).toBe("Bash");
  });

  it("removes empty event groups", () => {
    const settings = {
      env: { SAINTPEPSI_PAI_HOOKS_DIR: "/path" },
      hooks: {
        SessionEnd: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: "${SAINTPEPSI_PAI_HOOKS_DIR}/GitAutoSync.hook.ts",
              },
            ],
          },
        ],
      },
    };

    const result = removeHooksFromSettings(settings, "SAINTPEPSI_PAI_HOOKS_DIR");
    expect(result.hooks.SessionEnd).toBeUndefined();
  });

  it("leaves unrelated hooks untouched", () => {
    const settings = {
      env: { SAINTPEPSI_PAI_HOOKS_DIR: "/path" },
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "/my/own/hook.ts" }],
          },
        ],
      },
    };

    const result = removeHooksFromSettings(settings, "SAINTPEPSI_PAI_HOOKS_DIR");
    expect(result.hooks.PreToolUse).toHaveLength(1);
    expect(result.hooks.PreToolUse[0].hooks[0].command).toBe("/my/own/hook.ts");
  });
});
