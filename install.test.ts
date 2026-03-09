import { describe, it, expect } from "bun:test";
import { mergeHooksIntoSettings, isAlreadyInstalled, buildZshrcBlock, addToZshrc, removeFromZshrc } from "@hooks/install";

interface MatcherGroup {
  matcher: string;
  hooks: { type: string; command: string }[];
}

describe("isAlreadyInstalled", () => {
  it("returns false when env var is not set and no hooks present", () => {
    const settings = { env: {} };
    expect(isAlreadyInstalled(settings, "SAINTPEPSI_PAI_HOOKS_DIR")).toBe(false);
  });

  it("returns true when legacy env var is present", () => {
    const settings = { env: { SAINTPEPSI_PAI_HOOKS_DIR: "/some/path" } };
    expect(isAlreadyInstalled(settings, "SAINTPEPSI_PAI_HOOKS_DIR")).toBe(true);
  });

  it("returns true when hooks contain the env var reference", () => {
    const settings = {
      env: {},
      hooks: {
        PreToolUse: [
          { hooks: [{ type: "command", command: "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/Foo.hook.ts" }] },
        ],
      },
    };
    expect(isAlreadyInstalled(settings, "SAINTPEPSI_PAI_HOOKS_DIR")).toBe(true);
  });
});

describe("mergeHooksIntoSettings", () => {
  it("removes legacy env var from settings", () => {
    const settings = { env: { SAINTPEPSI_PAI_HOOKS_DIR: "/old/path" }, hooks: {} };
    const exported = {
      envVar: "SAINTPEPSI_PAI_HOOKS_DIR",
      hooks: {},
    };

    const result = mergeHooksIntoSettings(settings, exported);
    expect(result.env.SAINTPEPSI_PAI_HOOKS_DIR).toBeUndefined();
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

    const result = mergeHooksIntoSettings(settings, exported);

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

    const result = mergeHooksIntoSettings(settings, exported);
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

    const result = mergeHooksIntoSettings(settings, exported);

    const editMatchers = result.hooks.PreToolUse.filter(
      (m: MatcherGroup) => m.matcher === "Edit"
    );
    expect(editMatchers).toHaveLength(1);
    expect(result.env.SAINTPEPSI_PAI_HOOKS_DIR).toBeUndefined();
  });
});

describe("buildZshrcBlock", () => {
  it("creates a managed block with env var export", () => {
    const block = buildZshrcBlock("SAINTPEPSI_PAI_HOOKS_DIR", "pai-hooks");
    expect(block).toContain("PAI-HOOKS-BEGIN");
    expect(block).toContain("PAI-HOOKS-END");
    expect(block).toContain('export SAINTPEPSI_PAI_HOOKS_DIR="$PAI_DIR/pai-hooks"');
  });
});

describe("addToZshrc", () => {
  it("appends block after PAI-END if present", () => {
    const zshrc = "# some stuff\n# PAI-END\n# other stuff";
    const result = addToZshrc(zshrc, "SAINTPEPSI_PAI_HOOKS_DIR", "pai-hooks");
    expect(result).toContain("# PAI-END\n\n# PAI-HOOKS-BEGIN");
    expect(result).toContain('export SAINTPEPSI_PAI_HOOKS_DIR="$PAI_DIR/pai-hooks"');
    expect(result).toContain("# other stuff");
  });

  it("replaces existing managed block on re-install", () => {
    const zshrc = [
      "# before",
      "# PAI-HOOKS-BEGIN — managed by pai-hooks/install.ts, do not edit",
      'export SAINTPEPSI_PAI_HOOKS_DIR="$PAI_DIR/old-path"',
      "# PAI-HOOKS-END",
      "# after",
    ].join("\n");
    const result = addToZshrc(zshrc, "SAINTPEPSI_PAI_HOOKS_DIR", "pai-hooks");
    expect(result).toContain('export SAINTPEPSI_PAI_HOOKS_DIR="$PAI_DIR/pai-hooks"');
    expect(result).not.toContain("old-path");
    expect(result).toContain("# before");
    expect(result).toContain("# after");
  });

  it("appends to end if no PAI-END marker", () => {
    const zshrc = "# just some config\nexport PATH=/usr/bin";
    const result = addToZshrc(zshrc, "SAINTPEPSI_PAI_HOOKS_DIR", "pai-hooks");
    expect(result).toContain("export PATH=/usr/bin");
    expect(result).toContain("# PAI-HOOKS-BEGIN");
  });
});

describe("removeFromZshrc", () => {
  it("removes the managed block", () => {
    const zshrc = [
      "# before",
      "",
      "# PAI-HOOKS-BEGIN — managed by pai-hooks/install.ts, do not edit",
      'export SAINTPEPSI_PAI_HOOKS_DIR="$PAI_DIR/pai-hooks"',
      "# PAI-HOOKS-END",
      "",
      "# after",
    ].join("\n");
    const result = removeFromZshrc(zshrc);
    expect(result).not.toContain("PAI-HOOKS-BEGIN");
    expect(result).not.toContain("SAINTPEPSI_PAI_HOOKS_DIR");
    expect(result).toContain("# before");
    expect(result).toContain("# after");
  });

  it("returns content unchanged if no managed block", () => {
    const zshrc = "# no managed block here\nexport FOO=bar";
    expect(removeFromZshrc(zshrc)).toBe(zshrc);
  });
});
