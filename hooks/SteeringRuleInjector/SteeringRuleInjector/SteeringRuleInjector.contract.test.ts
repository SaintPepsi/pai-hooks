import { describe, expect, it } from "bun:test";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { SessionStartInput, UserPromptSubmitInput } from "@hooks/core/types/hook-inputs";
import type { ContextOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import {
  type InjectionTracker,
  type SteeringRuleConfig,
  type SteeringRuleInjectorDeps,
  SteeringRuleInjector,
  matchesKeywords,
  parseFrontmatter,
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
  return { session_id: "test-session-123" };
}

function makePromptInput(prompt: string): UserPromptSubmitInput {
  return { session_id: "test-session-123", prompt };
}

describe("SteeringRuleInjector contract", () => {
  it("has correct name and event", () => {
    expect(SteeringRuleInjector.name).toBe("SteeringRuleInjector");
    expect(SteeringRuleInjector.event).toEqual(["SessionStart", "UserPromptSubmit"]);
  });

  it("accepts all inputs", () => {
    expect(SteeringRuleInjector.accepts(makeSessionStartInput())).toBe(true);
    expect(SteeringRuleInjector.accepts(makePromptInput("test"))).toBe(true);
  });

  it("returns silent for subagents", () => {
    const deps = makeDeps({ isSubagent: () => true });
    const result = SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("returns silent when disabled", () => {
    const deps = makeDeps({ getConfig: () => makeConfig({ enabled: false }) });
    const result = SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("injects always-rules on SessionStart", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/always.md"],
      readFile: () => ALWAYS_RULE,
    });
    const result = SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("context");
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("Always inject this content.");
  });

  it("does NOT inject UserPromptSubmit-only rules on SessionStart", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/keyword.md"],
      readFile: () => KEYWORD_RULE,
    });
    const result = SteeringRuleInjector.execute(makeSessionStartInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("injects keyword-matched rules on UserPromptSubmit", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/keyword.md"],
      readFile: () => KEYWORD_RULE,
    });
    const result = SteeringRuleInjector.execute(makePromptInput("let's deploy this"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("context");
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("Deploy safety guidelines.");
  });

  it("returns silent when no keywords match prompt", () => {
    const deps = makeDeps({
      resolveGlobs: () => ["/rules/keyword.md"],
      readFile: () => KEYWORD_RULE,
    });
    const result = SteeringRuleInjector.execute(makePromptInput("refactor the parser"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
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
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
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
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("returns silent when no rule files resolve from globs", () => {
    const deps = makeDeps({
      resolveGlobs: () => [],
      readFile: () => null,
    });
    const result = SteeringRuleInjector.execute(makePromptInput("deploy now"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
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
    if (!result.ok) return;
    expect(result.value.type).toBe("context");
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("Always inject this content.");
    expect(result.value.content).toContain("Git workflow rules.");
    expect(result.value.content).toContain("\n\n---\n\n");
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
    if (!result.ok) return;
    expect(result.value.type).toBe("context");
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("Always inject this content.");
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
    if (!result.ok) return;
    expect(result.value.type).toBe("context");
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("Always inject this content.");
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
