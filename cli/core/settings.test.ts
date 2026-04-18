/**
 * Settings merge tests — verify append-only, idempotent behavior.
 *
 * Tests use InMemoryDeps from cli/types/deps.ts
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-a0619c6a/cli/types/deps.ts).
 */

import { describe, expect, it } from "bun:test";
import type { SettingsJson } from "@hooks/cli/core/settings";
import {
  detectForeignHooks,
  mergeHookEntry,
  readSettings,
  writeSettings,
} from "@hooks/cli/core/settings";
import { InMemoryDeps } from "@hooks/cli/types/deps";
import type { Lockfile } from "@hooks/cli/types/lockfile";

describe("readSettings", () => {
  it("returns empty settings when file does not exist", () => {
    const deps = new InMemoryDeps({}, "/test");
    const result = readSettings("/test/.claude", deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it("parses existing settings.json", () => {
    const settings: SettingsJson = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "./existing.ts" }] }],
      },
    };
    const deps = new InMemoryDeps({
      "/test/.claude/settings.json": JSON.stringify(settings),
    });
    const result = readSettings("/test/.claude", deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hooks?.PreToolUse).toHaveLength(1);
    }
  });

  it("returns error for invalid JSON", () => {
    const deps = new InMemoryDeps({
      "/test/.claude/settings.json": "not json{",
    });
    const result = readSettings("/test/.claude", deps);
    expect(result.ok).toBe(false);
  });
});

describe("writeSettings", () => {
  it("writes settings.json to target", () => {
    const deps = new InMemoryDeps({});
    deps.addFile("/test/.claude/settings.json", "{}");
    const settings: SettingsJson = { hooks: {} };
    const result = writeSettings("/test/.claude", settings, deps);
    expect(result.ok).toBe(true);
    const files = deps.getFiles();
    expect(files.has("/test/.claude/settings.json")).toBe(true);
  });
});

describe("mergeHookEntry", () => {
  it("merges into empty settings", () => {
    const settings: SettingsJson = {};
    const result = mergeHookEntry(settings, "PreToolUse", undefined, "./hooks/Test/Test.hook.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hooks?.PreToolUse).toHaveLength(1);
      expect(result.value.hooks?.PreToolUse?.[0].hooks[0].command).toBe(
        "./hooks/Test/Test.hook.ts",
      );
    }
  });

  it("appends to existing event array without modifying existing entries", () => {
    const settings: SettingsJson = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "./existing.ts" }] }],
      },
    };
    const result = mergeHookEntry(settings, "PreToolUse", undefined, "./hooks/New/New.hook.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Existing entry preserved
      expect(result.value.hooks?.PreToolUse?.[0].hooks[0].command).toBe("./existing.ts");
      // New entry appended to same matcher group
      expect(result.value.hooks?.PreToolUse?.[0].hooks[1].command).toBe("./hooks/New/New.hook.ts");
    }
  });

  it("is idempotent — does not duplicate existing command", () => {
    const settings: SettingsJson = {
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: "command", command: "./hooks/Test/Test.hook.ts" }],
          },
        ],
      },
    };
    const result = mergeHookEntry(settings, "PreToolUse", undefined, "./hooks/Test/Test.hook.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hooks?.PreToolUse?.[0].hooks).toHaveLength(1);
    }
  });

  it("creates separate matcher groups for different matchers", () => {
    const settings: SettingsJson = {};
    const r1 = mergeHookEntry(settings, "PreToolUse", "Bash", "./hooks/A/A.hook.ts");
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error(r1.error.message);

    const r2 = mergeHookEntry(r1.value, "PreToolUse", "Edit", "./hooks/B/B.hook.ts");
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.value.hooks?.PreToolUse).toHaveLength(2);
      expect(r2.value.hooks?.PreToolUse?.[0].matcher).toBe("Bash");
      expect(r2.value.hooks?.PreToolUse?.[1].matcher).toBe("Edit");
    }
  });

  it("never removes existing entries", () => {
    const settings: SettingsJson = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "./foreign.ts" }] }],
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "./bash-hook.ts" }],
          },
        ],
      },
    };
    const result = mergeHookEntry(settings, "PreToolUse", undefined, "./hooks/New/New.hook.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // SessionStart untouched
      expect(result.value.hooks?.SessionStart?.[0].hooks[0].command).toBe("./foreign.ts");
      // Bash matcher untouched
      expect(result.value.hooks?.PreToolUse?.[0].matcher).toBe("Bash");
      expect(result.value.hooks?.PreToolUse?.[0].hooks[0].command).toBe("./bash-hook.ts");
    }
  });
});

describe("detectForeignHooks", () => {
  it("identifies hooks not in the lockfile", () => {
    const settings: SettingsJson = {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: "./hooks/A/A.hook.ts" },
              { type: "command", command: "./foreign.ts" },
            ],
          },
        ],
      },
    };
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      source: "/src",
      sourceCommit: null,
      installedAt: "2025-01-01T00:00:00Z",
      outputMode: "source",
      hooks: [
        {
          name: "A",
          group: "TestGroup",
          event: "PreToolUse",
          commandString: "./hooks/A/A.hook.ts",
          files: [],
          fileHashes: {},
        },
      ],
    };
    const foreign = detectForeignHooks(settings, lockfile);
    expect(foreign).toHaveLength(1);
    expect(foreign[0].command).toBe("./foreign.ts");
  });

  it("returns empty when all hooks are tracked", () => {
    const settings: SettingsJson = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "./hooks/A/A.hook.ts" }] }],
      },
    };
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      source: "/src",
      sourceCommit: null,
      installedAt: "2025-01-01T00:00:00Z",
      outputMode: "source",
      hooks: [
        {
          name: "A",
          group: "TestGroup",
          event: "PreToolUse",
          commandString: "./hooks/A/A.hook.ts",
          files: [],
          fileHashes: {},
        },
      ],
    };
    const foreign = detectForeignHooks(settings, lockfile);
    expect(foreign).toHaveLength(0);
  });
});
