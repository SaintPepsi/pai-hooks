import { describe, expect, it } from "bun:test";
import type {
  SessionStartInput,
  StopInput,
  SubagentStartInput,
  ToolHookInput,
  UserPromptSubmitInput,
} from "@hooks/core/types/hook-inputs";
import {
  getReasonFromBlock as getBlockReason,
  getAdditionalContext as getInjectedContext,
  isBareContinue,
  isSilent,
} from "@hooks/lib/test-helpers";
import {
  type InjectionTracker,
  matchesKeywords,
  parseFrontmatter,
  type SteeringRuleConfig,
  SteeringRuleInjector,
  type SteeringRuleInjectorDeps,
} from "./SteeringRuleInjector.contract";

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with all fields", () => {
    const content = `---
name: test-rule
events: [SessionStart, UserPromptSubmit]
keywords: [push, remote]
---

Rule content here.`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("test-rule");
    expect(result!.events).toEqual(["SessionStart", "UserPromptSubmit"]);
    expect(result!.keywords).toEqual(["push", "remote"]);
    expect(result!.body).toBe("Rule content here.");
  });

  it("parses frontmatter with empty keywords", () => {
    const content = `---
name: always-rule
events: [SessionStart]
keywords: []
---

Always injected.`;
    const result = parseFrontmatter(content);
    expect(result!.keywords).toEqual([]);
  });

  it("returns null for missing frontmatter", () => {
    expect(parseFrontmatter("Just plain markdown.")).toBeNull();
  });

  it("returns null for missing name", () => {
    const content = `---
events: [SessionStart]
keywords: []
---
No name.`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  it("returns null for missing events", () => {
    const content = `---
name: no-events
keywords: []
---
No events.`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  it("trims body content", () => {
    const content = `---
name: trim-test
events: [SessionStart]
keywords: []
---

  Content with spaces.
`;
    expect(parseFrontmatter(content)!.body).toBe("Content with spaces.");
  });

  it("extracts dependsOn from depends-on Tool() items", () => {
    const content = `---
name: test-rule
events: [Stop]
keywords: []
depends-on: [Tool(Write), Tool(Edit), Tool(Bash)]
---

Body.`;
    const result = parseFrontmatter(content);
    expect(result!.dependsOn).toEqual(["Write", "Edit", "Bash"]);
  });

  it("returns undefined dependsOn when depends-on is absent", () => {
    const content = `---
name: test-rule
events: [Stop]
keywords: []
---

Body.`;
    const result = parseFrontmatter(content);
    expect(result!.dependsOn).toBeUndefined();
  });

  it("returns empty dependsOn when depends-on is empty array", () => {
    const content = `---
name: test-rule
events: [Stop]
keywords: []
depends-on: []
---

Body.`;
    const result = parseFrontmatter(content);
    expect(result!.dependsOn).toEqual([]);
  });

  it("ignores depends-on items that don't match Tool() syntax", () => {
    const content = `---
name: test-rule
events: [Stop]
keywords: []
depends-on: [Tool(Write), Skill(Foo), Mode(ALGORITHM), Tool(Bash)]
---

Body.`;
    const result = parseFrontmatter(content);
    expect(result!.dependsOn).toEqual(["Write", "Bash"]);
  });

  it("extracts dependsOn for MCP tool names with underscores", () => {
    const content = `---
name: test-rule
events: [Stop]
keywords: []
depends-on: [Tool(mcp__voice__speak), Tool(Edit)]
---

Body.`;
    const result = parseFrontmatter(content);
    expect(result!.dependsOn).toEqual(["mcp__voice__speak", "Edit"]);
  });
});

describe("matchesKeywords", () => {
  it("returns true when keyword in prompt", () => {
    expect(matchesKeywords("let's push to remote", ["push", "remote"])).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesKeywords("Minimize Output TOKENS", ["tokens"])).toBe(true);
  });

  it("returns false when no match", () => {
    expect(matchesKeywords("refactor the parser", ["push", "deploy"])).toBe(false);
  });

  it("returns false for empty keywords", () => {
    expect(matchesKeywords("anything here", [])).toBe(false);
  });
});

// ─── Contract Tests ─────────────────────────────────────────────────────────

const ALWAYS_RULE = `---
name: always-rule
events: [SessionStart]
keywords: []
---

Always inject this content.`;

const PRETOOLUSE_RULE = `---
name: pretool-rule
events: [PreToolUse]
keywords: [.css, .scss]
---

Browser-mandatory for CSS changes.`;

const POSTTOOLUSE_RULE = `---
name: posttool-rule
events: [PostToolUse]
keywords: [Edit, Write]
---

Verify after editing.`;

const SUBAGENT_RULE = `---
name: subagent-rule
events: [SubagentStart]
keywords: []
---

Least privilege for sub-agents.`;

const STOP_RULE = `---
name: stop-rule
events: [Stop]
keywords: [quick fix, workaround, shortcut]
---

Always go with the proper fix.`;

const KEYWORD_RULE = `---
name: keyword-rule
events: [UserPromptSubmit]
keywords: [deploy, push]
---

Deploy safety guidelines.`;

const BOTH_EVENTS_RULE = `---
name: both-rule
events: [SessionStart, UserPromptSubmit]
keywords: []
---

Git workflow rules.`;

function makeConfig(overrides: Partial<SteeringRuleConfig> = {}): SteeringRuleConfig {
  return {
    enabled: true,
    includes: ["test-rules/*.md"],
    trackerDir: "/tmp/test-injections",
    ...overrides,
  };
}

function makeTracker(overrides: Partial<InjectionTracker> = {}): InjectionTracker {
  return {
    sessionId: "test-session-123",
    injected: {},
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SteeringRuleInjectorDeps> = {}): SteeringRuleInjectorDeps {
  return {
    resolveGlobs: () => ["/rules/always.md", "/rules/keyword.md"],
    readFile: (path: string) => {
      if (path === "/rules/always.md") return ALWAYS_RULE;
      if (path === "/rules/keyword.md") return KEYWORD_RULE;
      return null;
    },
    readTracker: () => makeTracker(),
    writeTracker: () => {},
    getConfig: () => makeConfig(),
    isSubagent: () => false,
    stderr: () => {},
    ...overrides,
  };
}

function makeSessionStartInput(): SessionStartInput {
  return { session_id: "test-session-123", hook_event_name: "SessionStart" };
}

function makePromptInput(prompt: string): UserPromptSubmitInput {
  return { session_id: "test-session-123", hook_event_name: "UserPromptSubmit", prompt };
}

function makeToolInput(toolName: string, filePath: string): ToolHookInput {
  return {
    session_id: "test-session-123",
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: { file_path: filePath },
  };
}

function makePostToolInput(toolName: string, filePath: string): ToolHookInput {
  return {
    session_id: "test-session-123",
    hook_event_name: "PostToolUse",
    tool_name: toolName,
    tool_input: { file_path: filePath },
    tool_response: {},
  };
}

function makeSubagentInput(): SubagentStartInput {
  return {
    session_id: "test-session-123",
    hook_event_name: "SubagentStart",
    transcript_path: "/tmp/transcript.jsonl",
  };
}

function makeStopInput(lastMessage?: string): StopInput {
  return {
    session_id: "test-session-123",
    hook_event_name: "Stop",
    last_assistant_message: lastMessage,
    stop_hook_active: true,
  };
}

describe("SteeringRuleInjector contract", () => {
  it("has correct name and event", () => {
    expect(SteeringRuleInjector.name).toBe("SteeringRuleInjector");
    expect(SteeringRuleInjector.event).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "SubagentStart",
      "Stop",
    ]);
  });

  it("accepts all inputs", () => {
    expect(SteeringRuleInjector.accepts(makeSessionStartInput())).toBe(true);
    expect(SteeringRuleInjector.accepts(makePromptInput("test"))).toBe(true);
    expect(SteeringRuleInjector.accepts(makeToolInput("Edit", "foo.ts"))).toBe(true);
    expect(SteeringRuleInjector.accepts(makePostToolInput("Edit", "foo.ts"))).toBe(true);
    expect(SteeringRuleInjector.accepts(makeSubagentInput())).toBe(true);
    expect(SteeringRuleInjector.accepts(makeStopInput("test"))).toBe(true);
  });

  it("returns silent for subagents", () => {
    const deps = makeDeps({ isSubagent: () => true });
    const result = SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isSilent(result.value)).toBe(true);
  });

  it("returns silent when disabled", () => {
    const deps = makeDeps({ getConfig: () => makeConfig({ enabled: false }) });
    const result = SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isSilent(result.value)).toBe(true);
  });

  it("injects always-rules on SessionStart", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/always.md"],
      readFile: () => ALWAYS_RULE,
    });
    const result = SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getInjectedContext(result.value)).toContain("Always inject this content.");
  });

  it("does NOT inject UserPromptSubmit-only rules on SessionStart", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/keyword.md"],
      readFile: () => KEYWORD_RULE,
    });
    const result = SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isSilent(result.value)).toBe(true);
  });

  it("injects keyword-matched rules on UserPromptSubmit", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/keyword.md"],
      readFile: () => KEYWORD_RULE,
    });
    const result = SteeringRuleInjector.execute(makePromptInput("let's deploy this"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getInjectedContext(result.value)).toContain("Deploy safety guidelines.");
  });

  it("returns silent when no keywords match prompt", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/keyword.md"],
      readFile: () => KEYWORD_RULE,
    });
    const result = SteeringRuleInjector.execute(makePromptInput("refactor the parser"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isSilent(result.value)).toBe(true);
  });

  it("returns silent for empty-keyword rules on UserPromptSubmit", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/both.md"],
      readFile: () => BOTH_EVENTS_RULE,
    });
    const result = SteeringRuleInjector.execute(makePromptInput("anything here"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isSilent(result.value)).toBe(true);
  });

  it("skips already-injected rules", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/always.md"],
      readFile: () => ALWAYS_RULE,
      readTracker: () =>
        makeTracker({
          injected: {
            "always-rule": { event: "SessionStart", timestamp: "2026-01-01T00:00:00Z" },
          },
        }),
    });
    const result = SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isSilent(result.value)).toBe(true);
  });

  it("writes to tracker after injection", () => {
    let writtenTracker: InjectionTracker | null = null;
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/always.md"],
      readFile: () => ALWAYS_RULE,
      writeTracker: (tracker: InjectionTracker) => {
        writtenTracker = tracker;
      },
    });
    SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(writtenTracker).not.toBeNull();
    expect(writtenTracker!.injected["always-rule"]).toBeDefined();
    expect(writtenTracker!.injected["always-rule"].event).toBe("SessionStart");
  });

  it("returns silent when no rule files found", () => {
    const deps = makeDeps({
      resolveGlobs: () => [],
    });
    const result = SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isSilent(result.value)).toBe(true);
  });

  it("returns silent when no rule files resolve from globs", () => {
    const deps = makeDeps({
      resolveGlobs: () => [],
      readFile: () => null,
    });
    const result = SteeringRuleInjector.execute(makePromptInput("deploy now"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isSilent(result.value)).toBe(true);
  });

  it("returns bare continue (not silent) when no rule files found on PreToolUse", () => {
    const deps = makeDeps({
      resolveGlobs: () => [],
    });
    const result = SteeringRuleInjector.execute(makeToolInput("Edit", "foo.ts"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isBareContinue(result.value)).toBe(true);
  });

  it("concatenates multiple matched rules with separator", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/always.md", "/rules/both.md"],
      readFile: (path: string) => {
        if (path === "/rules/always.md") return ALWAYS_RULE;
        if (path === "/rules/both.md") return BOTH_EVENTS_RULE;
        return null;
      },
    });
    const result = SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getInjectedContext(result.value)).toContain("Always inject this content.");
    expect(getInjectedContext(result.value)).toContain("Git workflow rules.");
    expect(getInjectedContext(result.value)).toContain("\n\n---\n\n");
  });

  it("skips files with invalid frontmatter", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/bad.md", "/rules/always.md"],
      readFile: (path: string) => {
        if (path === "/rules/bad.md") return "No frontmatter here.";
        if (path === "/rules/always.md") return ALWAYS_RULE;
        return null;
      },
    });
    const result = SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getInjectedContext(result.value)).toContain("Always inject this content.");
  });

  it("skips files that cannot be read", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/missing.md", "/rules/always.md"],
      readFile: (path: string) => {
        if (path === "/rules/missing.md") return null;
        if (path === "/rules/always.md") return ALWAYS_RULE;
        return null;
      },
    });
    const result = SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getInjectedContext(result.value)).toContain("Always inject this content.");
  });

  it("injects matched rules on PreToolUse (keyword matches file path)", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/pretool.md"],
      readFile: () => PRETOOLUSE_RULE,
    });
    const result = SteeringRuleInjector.execute(makeToolInput("Edit", "src/main.css"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getInjectedContext(result.value)).toContain("Browser-mandatory for CSS changes.");
  });

  it("returns bare continue on PreToolUse when no keywords match", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/pretool.md"],
      readFile: () => PRETOOLUSE_RULE,
    });
    const result = SteeringRuleInjector.execute(makeToolInput("Edit", "src/middleware.ts"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isBareContinue(result.value)).toBe(true);
  });

  it("injects matched rules on PostToolUse (keyword matches tool name)", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/posttool.md"],
      readFile: () => POSTTOOLUSE_RULE,
    });
    const result = SteeringRuleInjector.execute(makePostToolInput("Edit", "src/foo.ts"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getInjectedContext(result.value)).toContain("Verify after editing.");
  });

  it("returns bare continue on PostToolUse when no keywords match", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/posttool.md"],
      readFile: () => POSTTOOLUSE_RULE,
    });
    const result = SteeringRuleInjector.execute(makePostToolInput("Read", "src/foo.ts"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isBareContinue(result.value)).toBe(true);
  });

  it("injects always-rules on SubagentStart", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/subagent.md"],
      readFile: () => SUBAGENT_RULE,
    });
    const result = SteeringRuleInjector.execute(makeSubagentInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getInjectedContext(result.value)).toContain("Least privilege for sub-agents.");
  });

  it("injects keyword-matched rules on Stop (matches last_assistant_message)", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/stop.md"],
      readFile: () => STOP_RULE,
    });
    const result = SteeringRuleInjector.execute(
      makeStopInput("Here's a quick fix: just disable the check"),
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getBlockReason(result.value)).toContain("Always go with the proper fix.");
  });

  it("returns silent on Stop when no keywords match last_assistant_message", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/stop.md"],
      readFile: () => STOP_RULE,
    });
    const result = SteeringRuleInjector.execute(
      makeStopInput("I implemented the proper solution with full test coverage."),
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isSilent(result.value)).toBe(true);
  });

  it("returns silent on Stop when last_assistant_message is missing", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/stop.md"],
      readFile: () => STOP_RULE,
    });
    const result = SteeringRuleInjector.execute(makeStopInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isSilent(result.value)).toBe(true);
  });

  it("matches keywords against tool_name + file_path combined", () => {
    const MULTI_KEYWORD_RULE = `---
name: multi-kw-rule
events: [PreToolUse]
keywords: [Edit, .css]
---

Matched on tool or path.`;
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/multi.md"],
      readFile: () => MULTI_KEYWORD_RULE,
    });
    const result = SteeringRuleInjector.execute(makeToolInput("Edit", "src/foo.ts"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getInjectedContext(result.value)).toContain("Matched on tool or path.");
  });

  it("matches keywords against tool_input.skill for Skill tool calls", () => {
    const SKILL_RULE = `---
name: skill-dogfood-rule
events: [PreToolUse]
keywords: [brainstorming, writing-plans]
---

Dogfood every task.`;
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/skill.md"],
      readFile: () => SKILL_RULE,
    });
    const input: ToolHookInput = {
      session_id: "test-session-123",
      hook_event_name: "PreToolUse",
      tool_name: "Skill",
      tool_input: { skill: "superpowers:brainstorming", args: "some topic" },
    };
    const result = SteeringRuleInjector.execute(input, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getInjectedContext(result.value)).toContain("Dogfood every task.");
  });

  it("does not match Skill tool when skill name has no keyword match", () => {
    const SKILL_RULE = `---
name: skill-dogfood-rule
events: [PreToolUse]
keywords: [brainstorming, writing-plans]
---

Dogfood every task.`;
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/skill.md"],
      readFile: () => SKILL_RULE,
    });
    const input: ToolHookInput = {
      session_id: "test-session-123",
      hook_event_name: "PreToolUse",
      tool_name: "Skill",
      tool_input: { skill: "commit" },
    };
    const result = SteeringRuleInjector.execute(input, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(isBareContinue(result.value)).toBe(true);
  });
});

describe("SteeringRuleInjector defaultDeps", () => {
  it("defaultDeps.isSubagent returns a boolean", () => {
    const result = SteeringRuleInjector.defaultDeps.isSubagent();
    expect(typeof result).toBe("boolean");
  });

  it("defaultDeps.getConfig returns a config object", () => {
    const config = SteeringRuleInjector.defaultDeps.getConfig();
    expect(typeof config.enabled).toBe("boolean");
    expect(Array.isArray(config.includes)).toBe(true);
    expect(typeof config.trackerDir).toBe("string");
  });

  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => SteeringRuleInjector.defaultDeps.stderr("test message")).not.toThrow();
  });
});

describe("SteeringRuleInjector fallback stderr logging", () => {
  it("calls deps.stderr when parseHookInput fails in resolveEvent and getMatchText", () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      resolveGlobs: () => [],
      stderr: (msg: string) => {
        stderrMessages.push(msg);
      },
    });
    // SessionStartInput.hook_type is optional in the TS interface — omitting it
    // satisfies the TypeScript type but fails the Effect schema (which requires
    // hook_type to be present and equal to a known literal).
    const inputMissingHookType: SessionStartInput = { session_id: "test-session-123" };
    SteeringRuleInjector.execute(inputMissingHookType, deps);

    expect(stderrMessages.some((m) => m.includes("event parse failed"))).toBe(true);
    expect(stderrMessages.some((m) => m.includes("input parse failed for keyword matching"))).toBe(
      true,
    );
  });
});
