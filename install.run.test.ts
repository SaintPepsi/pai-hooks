import { describe, expect, it } from "bun:test";
import {
  type Conflict,
  detectConflicts,
  type ExportedHooks,
  extractHookName,
  filterExportedByResolution,
  formatConflictSummary,
  type InstallDeps,
  type MatcherGroup,
  parseConflictFlag,
  run,
} from "@hooks/install";

// ─── Test Helpers ────────────────────────────────────────────────────────────

interface Captured {
  stdoutLines: string[];
  stderrLines: string[];
  writtenFiles: Map<string, string>;
}

function makeDeps(overrides: Partial<InstallDeps> = {}): InstallDeps & Captured {
  const captured: Captured = {
    stdoutLines: [],
    stderrLines: [],
    writtenFiles: new Map(),
  };
  return {
    ...captured,
    readFile: () => ({ ok: true, value: "{}" }),
    writeFile: (path: string, content: string) => {
      captured.writtenFiles.set(path, content);
      return { ok: true };
    },
    fileExists: () => true,
    stderr: (msg: string) => {
      captured.stderrLines.push(msg);
    },
    stdout: (msg: string) => {
      captured.stdoutLines.push(msg);
    },
    paiDir: "/tmp/test-pai",
    homeDir: "/tmp/test-home",
    argv: [],
    prompt: async () => "k",
    ...overrides,
  };
}

const validManifest = JSON.stringify({
  name: "saintpepsi-pai-hooks",
  envVar: "SAINTPEPSI_PAI_HOOKS_DIR",
});

const validExported = JSON.stringify({
  envVar: "SAINTPEPSI_PAI_HOOKS_DIR",
  hooks: {
    PreToolUse: [
      {
        matcher: "Edit",
        hooks: [
          {
            type: "command",
            command: "${SAINTPEPSI_PAI_HOOKS_DIR}/CodingStandards.hook.ts",
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: "${SAINTPEPSI_PAI_HOOKS_DIR}/BashAudit.hook.ts",
          },
          {
            type: "command",
            command: "${SAINTPEPSI_PAI_HOOKS_DIR}/BashLog.hook.ts",
          },
        ],
      },
    ],
  },
});

const emptySettings = JSON.stringify({ env: {}, hooks: {} });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("extractHookName", () => {
  it("extracts name from env var path with .hook.ts", () => {
    expect(extractHookName("${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SecurityValidator.hook.ts")).toBe(
      "SecurityValidator",
    );
  });

  it("extracts name from absolute path with .hook.ts", () => {
    expect(extractHookName("/home/user/.claude/hooks/SecurityValidator.hook.ts")).toBe(
      "SecurityValidator",
    );
  });

  it("extracts name from .sh extension", () => {
    expect(extractHookName("/usr/local/bin/my-guard.sh")).toBe("my-guard");
  });

  it("extracts name from .py extension", () => {
    expect(extractHookName("${SOME_DIR}/hooks/Validator.py")).toBe("Validator");
  });

  it("handles bare filename", () => {
    expect(extractHookName("SecurityValidator.hook.ts")).toBe("SecurityValidator");
  });

  it("handles filename with no extension", () => {
    expect(extractHookName("my-hook")).toBe("my-hook");
  });
});

describe("install run() — early returns", () => {
  it("returns early when pai-hooks.json not found", async () => {
    const deps = makeDeps({
      fileExists: (path: string) => !path.includes("pai-hooks.json"),
    });
    await run(deps);
    expect(deps.stderrLines.some((l) => l.includes("pai-hooks.json not found"))).toBe(true);
    expect(deps.writtenFiles.size).toBe(0);
  });

  it("returns early when settings.hooks.json not found", async () => {
    const deps = makeDeps({
      fileExists: (path: string) => !path.includes("settings.hooks.json"),
      readFile: () => ({ ok: true, value: validManifest }),
    });
    await run(deps);
    expect(deps.stderrLines.some((l) => l.includes("settings.hooks.json not found"))).toBe(true);
    expect(deps.writtenFiles.size).toBe(0);
  });

  it("returns early when ~/.claude/settings.json not found", async () => {
    let callCount = 0;
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json") && !path.includes("settings.hooks.json")) {
          return false;
        }
        return true;
      },
      readFile: (_path: string) => {
        callCount++;
        if (callCount === 1) return { ok: true, value: validManifest };
        if (callCount === 2) return { ok: true, value: validExported };
        return { ok: true, value: emptySettings };
      },
    });
    await run(deps);
    expect(
      deps.stderrLines.some((l) => l.includes("not found") && l.includes("settings.json")),
    ).toBe(true);
    expect(deps.writtenFiles.size).toBe(0);
  });

  it("returns early when manifest readFile fails", async () => {
    const deps = makeDeps({
      readFile: () => ({ ok: false, error: { message: "read error" } }),
    });
    await run(deps);
    expect(deps.writtenFiles.size).toBe(0);
  });
});

describe("install run() — successful install", () => {
  it("writes settings.json and .zshrc", async () => {
    let callCount = 0;
    const deps = makeDeps({
      readFile: () => {
        callCount++;
        if (callCount === 1) return { ok: true, value: validManifest };
        if (callCount === 2) return { ok: true, value: validExported };
        if (callCount === 3) return { ok: true, value: emptySettings };
        // zshrc read
        return { ok: true, value: "# existing zshrc\n# PAI-END\n" };
      },
    });
    await run(deps);

    expect(deps.writtenFiles.size).toBe(2);

    // Check settings.json was written with hooks but no env var
    const settingsPath = [...deps.writtenFiles.keys()].find((p) => p.endsWith("settings.json"))!;
    const written = JSON.parse(deps.writtenFiles.get(settingsPath)!);
    expect(written.env.SAINTPEPSI_PAI_HOOKS_DIR).toBeUndefined();
    expect(written.hooks.PreToolUse).toBeDefined();
    expect(written.hooks.PostToolUse).toBeDefined();

    // Check zshrc was written with managed block
    const zshrcPath = [...deps.writtenFiles.keys()].find((p) => p.endsWith(".zshrc"))!;
    const zshrc = deps.writtenFiles.get(zshrcPath)!;
    expect(zshrc).toContain("PAI-HOOKS-BEGIN");
    expect(zshrc).toContain("SAINTPEPSI_PAI_HOOKS_DIR");
  });

  it("reports hook count after install", async () => {
    let callCount = 0;
    const deps = makeDeps({
      readFile: () => {
        callCount++;
        if (callCount === 1) return { ok: true, value: validManifest };
        if (callCount === 2) return { ok: true, value: validExported };
        if (callCount === 3) return { ok: true, value: emptySettings };
        return { ok: true, value: "# zshrc\n" };
      },
    });
    await run(deps);

    // The exported hooks have 3 hooks across 2 matcher groups
    expect(
      deps.stdoutLines.some((l) => l.includes("3 hooks") && l.includes("2 matcher groups")),
    ).toBe(true);
  });

  it("shows re-install message when already installed", async () => {
    const settingsWithEnv = JSON.stringify({
      env: { SAINTPEPSI_PAI_HOOKS_DIR: "/old/path" },
      hooks: {},
    });
    let callCount = 0;
    const deps = makeDeps({
      readFile: () => {
        callCount++;
        if (callCount === 1) return { ok: true, value: validManifest };
        if (callCount === 2) return { ok: true, value: validExported };
        if (callCount === 3) return { ok: true, value: settingsWithEnv };
        return { ok: true, value: "# zshrc\n" };
      },
    });
    await run(deps);

    expect(
      deps.stdoutLines.some((l) => l.includes("already installed") && l.includes("Re-installing")),
    ).toBe(true);
  });

  it("removes legacy env var from settings on re-install", async () => {
    const settingsWithEnv = JSON.stringify({
      env: { SAINTPEPSI_PAI_HOOKS_DIR: "/old/path", OTHER: "keep" },
      hooks: {},
    });
    let callCount = 0;
    const deps = makeDeps({
      readFile: () => {
        callCount++;
        if (callCount === 1) return { ok: true, value: validManifest };
        if (callCount === 2) return { ok: true, value: validExported };
        if (callCount === 3) return { ok: true, value: settingsWithEnv };
        return { ok: true, value: "# zshrc\n" };
      },
    });
    await run(deps);

    const settingsPath = [...deps.writtenFiles.keys()].find((p) => p.endsWith("settings.json"))!;
    const written = JSON.parse(deps.writtenFiles.get(settingsPath)!);
    expect(written.env.SAINTPEPSI_PAI_HOOKS_DIR).toBeUndefined();
    expect(written.env.OTHER).toBe("keep");
  });
});

describe("detectConflicts", () => {
  it("returns empty array when no conflicts", () => {
    const existing = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "${PAI_DIR}/hooks/MyCustomHook.hook.ts",
            },
          ],
        },
      ],
    };
    const incoming = {
      PreToolUse: [
        {
          matcher: "Edit",
          hooks: [
            {
              type: "command",
              command: "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/CodingStandards.hook.ts",
            },
          ],
        },
      ],
    };
    expect(detectConflicts(existing, incoming, "SAINTPEPSI_PAI_HOOKS_DIR")).toEqual([]);
  });

  it("detects conflict when same hook name exists from different source", () => {
    const existing = {
      PreToolUse: [
        {
          matcher: "Edit",
          hooks: [
            {
              type: "command",
              command: "${PAI_DIR}/hooks/SecurityValidator.hook.ts",
            },
          ],
        },
      ],
    };
    const incoming = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SecurityValidator.hook.ts",
            },
          ],
        },
      ],
    };
    const conflicts = detectConflicts(existing, incoming, "SAINTPEPSI_PAI_HOOKS_DIR");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].name).toBe("SecurityValidator");
    expect(conflicts[0].existingCommand).toContain("PAI_DIR");
    expect(conflicts[0].incomingCommand).toContain("SAINTPEPSI_PAI_HOOKS_DIR");
  });

  it("ignores hooks already owned by the same env var", () => {
    const existing = {
      PreToolUse: [
        {
          matcher: "Edit",
          hooks: [
            {
              type: "command",
              command: "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SecurityValidator.hook.ts",
            },
          ],
        },
      ],
    };
    const incoming = {
      PreToolUse: [
        {
          matcher: "Edit",
          hooks: [
            {
              type: "command",
              command: "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SecurityValidator.hook.ts",
            },
          ],
        },
      ],
    };
    expect(detectConflicts(existing, incoming, "SAINTPEPSI_PAI_HOOKS_DIR")).toEqual([]);
  });

  it("detects conflicts across different events", () => {
    const existing = {
      PostToolUse: [
        {
          matcher: "Write",
          hooks: [{ type: "command", command: "/custom/path/BashWriteGuard.sh" }],
        },
      ],
    };
    const incoming = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/BashWriteGuard.hook.ts",
            },
          ],
        },
      ],
    };
    const conflicts = detectConflicts(existing, incoming, "SAINTPEPSI_PAI_HOOKS_DIR");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].name).toBe("BashWriteGuard");
  });

  it("deduplicates conflicts when same name appears in multiple events", () => {
    const existing = {
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
      PostToolUse: [
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
    };
    const incoming = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SecurityValidator.hook.ts",
            },
          ],
        },
      ],
    };
    const conflicts = detectConflicts(existing, incoming, "SAINTPEPSI_PAI_HOOKS_DIR");
    expect(conflicts).toHaveLength(1);
  });

  it("handles matcher groups without matcher field (SessionEnd style)", () => {
    const existing = {
      SessionEnd: [
        {
          hooks: [
            {
              type: "command",
              command: "${PAI_DIR}/hooks/SessionSummary.hook.ts",
            },
          ],
        },
      ],
    };
    const incoming = {
      SessionEnd: [
        {
          hooks: [
            {
              type: "command",
              command: "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SessionSummary.hook.ts",
            },
          ],
        },
      ],
    };
    const conflicts = detectConflicts(existing, incoming, "SAINTPEPSI_PAI_HOOKS_DIR");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].name).toBe("SessionSummary");
  });
});

describe("parseConflictFlag", () => {
  it("returns null when no flag provided", () => {
    expect(parseConflictFlag([])).toBeNull();
  });

  it("parses --replace flag", () => {
    expect(parseConflictFlag(["--replace"])).toBe("replace");
  });

  it("parses --keep flag", () => {
    expect(parseConflictFlag(["--keep"])).toBe("keep");
  });

  it("parses --both flag", () => {
    expect(parseConflictFlag(["--both"])).toBe("both");
  });

  it("ignores unrelated flags", () => {
    expect(parseConflictFlag(["--verbose", "--debug"])).toBeNull();
  });
});

describe("install run() — conflict resolution", () => {
  const settingsWithExistingHook = JSON.stringify({
    env: {},
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit",
          hooks: [
            {
              type: "command",
              command: "${PAI_DIR}/hooks/CodingStandards.hook.ts",
            },
          ],
        },
      ],
    },
  });

  it("installs without prompt when no conflicts", async () => {
    let callCount = 0;
    let promptCalled = false;
    const deps = makeDeps({
      readFile: () => {
        callCount++;
        if (callCount === 1) return { ok: true, value: validManifest };
        if (callCount === 2) return { ok: true, value: validExported };
        if (callCount === 3) return { ok: true, value: emptySettings };
        return { ok: true, value: "# zshrc\n" };
      },
      prompt: async () => {
        promptCalled = true;
        return "r";
      },
    });
    await run(deps);
    expect(promptCalled).toBe(false);
    expect(deps.writtenFiles.size).toBe(2);
  });

  it("prompts user when conflicts exist and no CLI flag", async () => {
    let callCount = 0;
    let promptCalled = false;
    const deps = makeDeps({
      readFile: () => {
        callCount++;
        if (callCount === 1) return { ok: true, value: validManifest };
        if (callCount === 2) return { ok: true, value: validExported };
        if (callCount === 3) return { ok: true, value: settingsWithExistingHook };
        return { ok: true, value: "# zshrc\n" };
      },
      prompt: async () => {
        promptCalled = true;
        return "r";
      },
    });
    await run(deps);
    expect(promptCalled).toBe(true);
  });

  it("replaces conflicting hooks when --replace flag is set", async () => {
    let callCount = 0;
    const deps = makeDeps({
      readFile: () => {
        callCount++;
        if (callCount === 1) return { ok: true, value: validManifest };
        if (callCount === 2) return { ok: true, value: validExported };
        if (callCount === 3) return { ok: true, value: settingsWithExistingHook };
        return { ok: true, value: "# zshrc\n" };
      },
      argv: ["--replace"],
    });
    await run(deps);

    const settingsPath = [...deps.writtenFiles.keys()].find((p) => p.endsWith("settings.json"))!;
    const written = JSON.parse(deps.writtenFiles.get(settingsPath)!);
    // The PAI_DIR CodingStandards hook should be gone, replaced by our version
    const allCommands: string[] = [];
    for (const matchers of Object.values(written.hooks)) {
      for (const group of matchers as MatcherGroup[]) {
        for (const h of group.hooks) {
          if (extractHookName(h.command) === "CodingStandards") {
            allCommands.push(h.command);
          }
        }
      }
    }
    expect(allCommands.length).toBe(1);
    expect(allCommands[0]).toContain("SAINTPEPSI_PAI_HOOKS_DIR");
  });

  it("keeps existing hooks when --keep flag is set", async () => {
    let callCount = 0;
    const deps = makeDeps({
      readFile: () => {
        callCount++;
        if (callCount === 1) return { ok: true, value: validManifest };
        if (callCount === 2) return { ok: true, value: validExported };
        if (callCount === 3) return { ok: true, value: settingsWithExistingHook };
        return { ok: true, value: "# zshrc\n" };
      },
      argv: ["--keep"],
    });
    await run(deps);

    const settingsPath = [...deps.writtenFiles.keys()].find((p) => p.endsWith("settings.json"))!;
    const written = JSON.parse(deps.writtenFiles.get(settingsPath)!);
    const allCommands: string[] = [];
    for (const matchers of Object.values(written.hooks)) {
      for (const group of matchers as MatcherGroup[]) {
        for (const h of group.hooks) {
          if (extractHookName(h.command) === "CodingStandards") {
            allCommands.push(h.command);
          }
        }
      }
    }
    // Should only have the existing PAI_DIR one
    expect(allCommands.length).toBe(1);
    expect(allCommands[0]).toContain("PAI_DIR");
  });

  it("keeps both when --both flag is set", async () => {
    let callCount = 0;
    const deps = makeDeps({
      readFile: () => {
        callCount++;
        if (callCount === 1) return { ok: true, value: validManifest };
        if (callCount === 2) return { ok: true, value: validExported };
        if (callCount === 3) return { ok: true, value: settingsWithExistingHook };
        return { ok: true, value: "# zshrc\n" };
      },
      argv: ["--both"],
    });
    await run(deps);

    const settingsPath = [...deps.writtenFiles.keys()].find((p) => p.endsWith("settings.json"))!;
    const written = JSON.parse(deps.writtenFiles.get(settingsPath)!);
    const allCommands: string[] = [];
    for (const matchers of Object.values(written.hooks)) {
      for (const group of matchers as MatcherGroup[]) {
        for (const h of group.hooks) {
          if (extractHookName(h.command) === "CodingStandards") {
            allCommands.push(h.command);
          }
        }
      }
    }
    expect(allCommands.length).toBe(2);
  });

  it("prints conflict summary to stdout", async () => {
    let callCount = 0;
    const deps = makeDeps({
      readFile: () => {
        callCount++;
        if (callCount === 1) return { ok: true, value: validManifest };
        if (callCount === 2) return { ok: true, value: validExported };
        if (callCount === 3) return { ok: true, value: settingsWithExistingHook };
        return { ok: true, value: "# zshrc\n" };
      },
      argv: ["--replace"],
    });
    await run(deps);

    expect(deps.stdoutLines.some((l) => l.includes("conflict") || l.includes("Conflict"))).toBe(
      true,
    );
    expect(deps.stdoutLines.some((l) => l.includes("CodingStandards"))).toBe(true);
  });

  it("defaults to keep when prompt gets invalid input", async () => {
    let callCount = 0;
    const deps = makeDeps({
      readFile: () => {
        callCount++;
        if (callCount === 1) return { ok: true, value: validManifest };
        if (callCount === 2) return { ok: true, value: validExported };
        if (callCount === 3) return { ok: true, value: settingsWithExistingHook };
        return { ok: true, value: "# zshrc\n" };
      },
      prompt: async () => "x",
    });
    await run(deps);

    const settingsPath = [...deps.writtenFiles.keys()].find((p) => p.endsWith("settings.json"))!;
    const written = JSON.parse(deps.writtenFiles.get(settingsPath)!);
    const allCommands: string[] = [];
    for (const matchers of Object.values(written.hooks)) {
      for (const group of matchers as MatcherGroup[]) {
        for (const h of group.hooks) {
          if (extractHookName(h.command) === "CodingStandards") {
            allCommands.push(h.command);
          }
        }
      }
    }
    // Invalid input defaults to keep — only existing stays
    expect(allCommands.length).toBe(1);
    expect(allCommands[0]).toContain("PAI_DIR");
  });
});

describe("filterExportedByResolution", () => {
  const exported: ExportedHooks = {
    envVar: "SAINTPEPSI_PAI_HOOKS_DIR",
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit",
          hooks: [
            {
              type: "command",
              command: "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/CodingStandards.hook.ts",
            },
          ],
        },
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SecurityValidator.hook.ts",
            },
          ],
        },
      ],
    },
  };
  const conflicts: Conflict[] = [
    {
      name: "CodingStandards",
      existingCommand: "${PAI_DIR}/hooks/CodingStandards.hook.ts",
      incomingCommand: "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/CodingStandards.hook.ts",
    },
  ];

  it("returns exported unchanged for 'both' mode", () => {
    const result = filterExportedByResolution(exported, conflicts, "both");
    expect(result).toEqual(exported);
  });

  it("removes conflicting hooks for 'keep' mode", () => {
    const result = filterExportedByResolution(exported, conflicts, "keep");
    // CodingStandards should be removed, SecurityValidator stays
    const allHookNames = Object.values(result.hooks)
      .flat()
      .flatMap((g) => g.hooks.map((h) => extractHookName(h.command)));
    expect(allHookNames).not.toContain("CodingStandards");
    expect(allHookNames).toContain("SecurityValidator");
  });

  it("returns exported unchanged for 'replace' mode", () => {
    const result = filterExportedByResolution(exported, conflicts, "replace");
    expect(result).toEqual(exported);
  });

  it("returns exported unchanged when no conflicts", () => {
    const result = filterExportedByResolution(exported, [], "keep");
    expect(result).toEqual(exported);
  });
});

describe("formatConflictSummary", () => {
  it("formats single conflict", () => {
    const conflicts: Conflict[] = [
      {
        name: "SecurityValidator",
        existingCommand: "${PAI_DIR}/hooks/SecurityValidator.hook.ts",
        incomingCommand: "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SecurityValidator.hook.ts",
      },
    ];
    const result = formatConflictSummary(conflicts);
    expect(result).toContain("SecurityValidator");
    expect(result).toContain("1 conflict found");
    expect(result).toContain("[k]eep");
    expect(result).toContain("[r]eplace");
    expect(result).toContain("[b]oth");
  });

  it("formats multiple conflicts with plural", () => {
    const conflicts: Conflict[] = [
      { name: "A", existingCommand: "a1", incomingCommand: "a2" },
      { name: "B", existingCommand: "b1", incomingCommand: "b2" },
    ];
    const result = formatConflictSummary(conflicts);
    expect(result).toContain("2 conflicts found");
  });
});
