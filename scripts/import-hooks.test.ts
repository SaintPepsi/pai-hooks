import { describe, it, expect } from "bun:test";
import { mergeHooksIntoSettings } from "@hooks/install";

describe("import-hooks (reuses mergeHooksIntoSettings)", () => {
  it("merges exported hooks into empty settings", () => {
    const settings = { env: {}, hooks: {} };
    const exported = {
      envVar: "SAINTPEPSI_PAI_HOOKS_DIR",
      hooks: {
        PreToolUse: [
          { matcher: "Edit", hooks: [{ type: "command", command: "${SAINTPEPSI_PAI_HOOKS_DIR}/Foo.hook.ts" }] },
        ],
      },
    };

    const result = mergeHooksIntoSettings(settings, exported);

    expect(result.env.SAINTPEPSI_PAI_HOOKS_DIR).toBeUndefined();
    expect(result.hooks.PreToolUse).toHaveLength(1);
    expect(result.hooks.PreToolUse[0].hooks[0].command).toBe("${SAINTPEPSI_PAI_HOOKS_DIR}/Foo.hook.ts");
  });

  it("preserves existing non-repo hooks during merge", () => {
    const settings = {
      env: {},
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "/my/custom/hook.ts" }] },
        ],
      },
    };
    const exported = {
      envVar: "SAINTPEPSI_PAI_HOOKS_DIR",
      hooks: {
        PreToolUse: [
          { matcher: "Edit", hooks: [{ type: "command", command: "${SAINTPEPSI_PAI_HOOKS_DIR}/Foo.hook.ts" }] },
        ],
      },
    };

    const result = mergeHooksIntoSettings(settings, exported);

    expect(result.hooks.PreToolUse).toHaveLength(2);
    expect(result.hooks.PreToolUse[0].hooks[0].command).toBe("/my/custom/hook.ts");
  });

  it("updates env var path on re-import", () => {
    const settings = {
      env: { SAINTPEPSI_PAI_HOOKS_DIR: "/old/path" },
      hooks: {
        PreToolUse: [
          { matcher: "Edit", hooks: [{ type: "command", command: "${SAINTPEPSI_PAI_HOOKS_DIR}/Foo.hook.ts" }] },
        ],
      },
    };
    const exported = {
      envVar: "SAINTPEPSI_PAI_HOOKS_DIR",
      hooks: {
        PreToolUse: [
          { matcher: "Edit", hooks: [{ type: "command", command: "${SAINTPEPSI_PAI_HOOKS_DIR}/Foo.hook.ts" }] },
        ],
      },
    };

    const result = mergeHooksIntoSettings(settings, exported);

    expect(result.env.SAINTPEPSI_PAI_HOOKS_DIR).toBeUndefined();
    expect(result.hooks.PreToolUse).toHaveLength(1);
  });
});
