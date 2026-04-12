import { describe, expect, it } from "bun:test";
import { extractHooksForRepo } from "@hooks/scripts/export-hooks";

describe("extractHooksForRepo", () => {
  it("extracts only hooks matching the source path prefix", () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [
              {
                type: "command",
                command: "${PAI_DIR}/hooks/CodingStandardsEnforcer.hook.ts",
              },
              { type: "command", command: "/other/path/MyHook.hook.ts" },
            ],
          },
        ],
      },
    };

    const result = extractHooksForRepo(
      settings,
      "${PAI_DIR}/hooks/",
      "${SAINTPEPSI_PAI_HOOKS_DIR}/",
    );

    expect(result.hooks.PreToolUse).toHaveLength(1);
    expect(result.hooks.PreToolUse[0].hooks[0].command).toBe(
      "${SAINTPEPSI_PAI_HOOKS_DIR}/CodingStandardsEnforcer.hook.ts",
    );
  });

  it("preserves matcher when filtering hooks within a matcher group", () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: "${PAI_DIR}/hooks/SecurityValidator.hook.ts",
              },
            ],
          },
        ],
      },
    };

    const result = extractHooksForRepo(
      settings,
      "${PAI_DIR}/hooks/",
      "${SAINTPEPSI_PAI_HOOKS_DIR}/",
    );
    expect(result.hooks.PreToolUse[0].matcher).toBe("Bash");
  });

  it("drops empty matcher groups after filtering", () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "/other/path/MyHook.hook.ts" }],
          },
        ],
      },
    };

    const result = extractHooksForRepo(
      settings,
      "${PAI_DIR}/hooks/",
      "${SAINTPEPSI_PAI_HOOKS_DIR}/",
    );
    expect(result.hooks.PreToolUse).toBeUndefined();
  });

  it("drops empty event groups after filtering", () => {
    const settings = {
      hooks: {
        SessionEnd: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "/unrelated/hook.ts" }],
          },
        ],
      },
    };

    const result = extractHooksForRepo(
      settings,
      "${PAI_DIR}/hooks/",
      "${SAINTPEPSI_PAI_HOOKS_DIR}/",
    );
    expect(Object.keys(result.hooks)).toHaveLength(0);
  });
});
