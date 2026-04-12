/**
 * WikiContextInjector Contract Tests
 *
 * Tests the pure functions (buildDomainIndex, matchDomain, extractSummary)
 * and the contract's accepts() and execute() methods including concept page
 * indexing, dedup behavior, and injection metrics.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { ok } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getInjectedContextFor, makeToolInput } from "@hooks/lib/test-helpers";
import {
  _resetCache,
  buildDomainIndex,
  type DomainIndex,
  extractSummary,
  matchDomain,
  WikiContextInjector,
  type WikiContextInjectorDeps,
} from "./WikiContextInjector.contract";

// ─── Test Helpers ───────────────────────────────────────────────────────────

beforeEach(() => {
  _resetCache();
});

function makeDeps(overrides: Partial<WikiContextInjectorDeps> = {}): WikiContextInjectorDeps {
  return {
    readDir: () => ok([]),
    readFile: () => ok(""),
    appendFile: () => ok(undefined),
    wikiDir: "/tmp/test-wiki",
    stderr: () => {},
    ...overrides,
  };
}

// ─── buildDomainIndex ───────────────────────────────────────────────────────

describe("buildDomainIndex", () => {
  it("indexes entity pages by domain", () => {
    const mockPages = {
      "entities/koord.md": {
        title: "Koord",
        domain: ["multi-agent", "discord"],
        summary: "Multi-agent coordination system.",
      },
    };
    const index = buildDomainIndex(mockPages);
    expect(index["multi-agent"]).toBeDefined();
    expect(index.discord).toBeDefined();
    expect(index["multi-agent"][0].title).toBe("Koord");
  });

  it("indexes by title as well as domain", () => {
    const mockPages = {
      "entities/koord.md": {
        title: "Koord",
        domain: ["multi-agent"],
        summary: "Multi-agent coordination system.",
      },
    };
    const index = buildDomainIndex(mockPages);
    expect(index.koord).toBeDefined();
    expect(index.koord[0].title).toBe("Koord");
  });

  it("handles multiple pages sharing a domain", () => {
    const mockPages = {
      "entities/koord.md": {
        title: "Koord",
        domain: ["discord"],
        summary: "Coordination system.",
      },
      "entities/draad.md": {
        title: "Draad",
        domain: ["discord"],
        summary: "Peer-to-peer mesh.",
      },
    };
    const index = buildDomainIndex(mockPages);
    expect(index.discord.length).toBe(2);
  });

  it("returns empty index for empty input", () => {
    const index = buildDomainIndex({});
    expect(Object.keys(index).length).toBe(0);
  });
});

// ─── matchDomain ────────────────────────────────────────────────────────────

describe("matchDomain", () => {
  it("matches file path to domain via project directory", () => {
    const index: DomainIndex = {
      koord: [
        {
          title: "Koord",
          path: "entities/koord.md",
          summary: "Multi-agent system.",
        },
      ],
    };
    const result = matchDomain("/Users/hogers/Projects/koord/src/agent.ts", index);
    expect(result).toBeDefined();
    expect(result![0].title).toBe("Koord");
  });

  it("returns null for unmatched paths", () => {
    const index: DomainIndex = {};
    const result = matchDomain("/Users/hogers/random/file.ts", index);
    expect(result).toBeNull();
  });

  it("matches case-insensitively", () => {
    const index: DomainIndex = {
      koord: [
        {
          title: "Koord",
          path: "entities/koord.md",
          summary: "Multi-agent system.",
        },
      ],
    };
    const result = matchDomain("/Users/hogers/Projects/Koord/src/agent.ts", index);
    expect(result).toBeDefined();
  });

  it("limits results to 2 entries", () => {
    const index: DomainIndex = {
      discord: [
        { title: "A", path: "a.md", summary: "A" },
        { title: "B", path: "b.md", summary: "B" },
        { title: "C", path: "c.md", summary: "C" },
      ],
    };
    const result = matchDomain("/Users/hogers/discord/main.ts", index);
    expect(result).toBeDefined();
    expect(result!.length).toBe(2);
  });
});

// ─── extractSummary ─────────────────────────────────────────────────────────

describe("extractSummary", () => {
  it("extracts Summary section from markdown", () => {
    const content = `---
title: Koord
---

## Summary
Multi-agent coordination via Discord.

## Key Facts
- Some fact`;
    const summary = extractSummary(content);
    expect(summary).toBe("Multi-agent coordination via Discord.");
  });

  it("extracts multi-line summary", () => {
    const content = `---
title: Test
---

## Summary
First line of summary.
Second line continues.

## Key Facts
- Fact`;
    const summary = extractSummary(content);
    expect(summary).toBe("First line of summary. Second line continues.");
  });

  it("returns empty string when no Summary section", () => {
    const content = `---
title: Test
---

## Key Facts
- Something`;
    const summary = extractSummary(content);
    expect(summary).toBe("");
  });

  it("handles Summary as last section", () => {
    const content = `---
title: Test
---

## Summary
Final section content.`;
    const summary = extractSummary(content);
    expect(summary).toBe("Final section content.");
  });

  it("extracts Definition section from concept pages", () => {
    const content = `---
title: "Canonical state pattern"
type: concept
tags: []
---

## Definition
Array-based reactive state with sequential ID assignment and self-cleanup timers.

## How It Appears
- In svelte stores`;
    const summary = extractSummary(content);
    expect(summary).toBe(
      "Array-based reactive state with sequential ID assignment and self-cleanup timers.",
    );
  });

  it("prefers Summary over Definition when both present", () => {
    const content = `---
title: Test
---

## Summary
The summary wins.

## Definition
The definition loses.`;
    const summary = extractSummary(content);
    expect(summary).toBe("The summary wins.");
  });
});

// ─── accepts() gate ─────────────────────────────────────────────────────────

describe("WikiContextInjector.accepts()", () => {
  it("accepts Write", () => {
    expect(WikiContextInjector.accepts(makeToolInput("Write", "/tmp/f.ts"))).toBe(true);
  });

  it("accepts Edit", () => {
    expect(WikiContextInjector.accepts(makeToolInput("Edit", "/tmp/f.ts"))).toBe(true);
  });

  it("rejects Read", () => {
    expect(WikiContextInjector.accepts(makeToolInput("Read", "/tmp/f.ts"))).toBe(false);
  });

  it("rejects Bash", () => {
    expect(WikiContextInjector.accepts(makeToolInput("Bash", "/tmp/f.ts"))).toBe(false);
  });

  it("rejects Glob", () => {
    expect(WikiContextInjector.accepts(makeToolInput("Glob", "/tmp/f.ts"))).toBe(false);
  });

  it("rejects unknown tools", () => {
    expect(WikiContextInjector.accepts(makeToolInput("NotATool", "/tmp/f.ts"))).toBe(false);
  });
});

// ─── execute() ──────────────────────────────────────────────────────────────

describe("WikiContextInjector.execute()", () => {
  const KOORD_PAGE = `---
title: "koord"
type: entity
domain: [koord]
---

## Summary
Multi-agent coordination system via Discord.

## Key Facts
- Some fact`;

  const CONCEPT_PAGE = `---
title: "Design-first methodology"
type: concept
tags: []
---

## Definition
Exploring requirements and design before writing implementation code.

## How It Appears
- In planning sessions`;

  /** Creates deps that serve entity files from readDir("entities") and concept files from readDir("concepts"). */
  function makeDualDirDeps(
    entityFiles: string[],
    conceptFiles: string[],
    fileMap: Record<string, string>,
    overrides: Partial<WikiContextInjectorDeps> = {},
  ): WikiContextInjectorDeps {
    return makeDeps({
      readDir: (path: string) => {
        if (path.endsWith("/entities")) return ok(entityFiles);
        if (path.endsWith("/concepts")) return ok(conceptFiles);
        return ok([]);
      },
      readFile: (path: string) => {
        for (const [key, content] of Object.entries(fileMap)) {
          if (path.endsWith(key)) return ok(content);
        }
        return ok("");
      },
      ...overrides,
    });
  }

  it("returns continue with additionalContext when domain matches", () => {
    const deps = makeDualDirDeps(["koord.md"], [], { "koord.md": KOORD_PAGE });
    const input = makeToolInput("Write", "/Users/hogers/Projects/koord/src/agent.ts");
    const result = WikiContextInjector.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.continue).toBe(true);
      const ctx = getInjectedContextFor(result.value, "PreToolUse");
      expect(ctx).toBeDefined();
      expect(ctx).toContain("koord");
      expect(ctx).toContain("Multi-agent coordination system via Discord.");
    }
  });

  it("returns plain continue when no domain matches", () => {
    const deps = makeDualDirDeps(["koord.md"], [], { "koord.md": KOORD_PAGE });
    const input = makeToolInput("Edit", "/Users/hogers/unrelated-project/src/main.ts");
    const result = WikiContextInjector.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.continue).toBe(true);
      expect(getInjectedContextFor(result.value, "PreToolUse")).toBeUndefined();
    }
  });

  it("returns plain continue when file_path is missing", () => {
    const deps = makeDualDirDeps(["koord.md"], [], { "koord.md": KOORD_PAGE });
    const input: ToolHookInput = {
      session_id: "test-sess",
      tool_name: "Write",
      tool_input: {},
    };
    const result = WikiContextInjector.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(getInjectedContextFor(result.value, "PreToolUse")).toBeUndefined();
    }
  });

  it("returns plain continue when wiki directory is empty", () => {
    const deps = makeDeps({
      readDir: () => ok([]),
    });
    const input = makeToolInput("Write", "/Users/hogers/Projects/koord/src/agent.ts");
    const result = WikiContextInjector.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(getInjectedContextFor(result.value, "PreToolUse")).toBeUndefined();
    }
  });

  it("indexes and injects concept pages by slugified title", () => {
    const deps = makeDualDirDeps([], ["design-first-methodology.md"], {
      "design-first-methodology.md": CONCEPT_PAGE,
    });
    const input = makeToolInput("Edit", "/Users/hogers/Projects/design-first-methodology/notes.md");
    const result = WikiContextInjector.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ctx = getInjectedContextFor(result.value, "PreToolUse");
      expect(ctx).toBeDefined();
      expect(ctx).toContain("Design-first methodology");
      expect(ctx).toContain(
        "Exploring requirements and design before writing implementation code.",
      );
    }
  });

  it("indexes both entities and concepts in the same index", () => {
    const deps = makeDualDirDeps(["koord.md"], ["design-first-methodology.md"], {
      "koord.md": KOORD_PAGE,
      "design-first-methodology.md": CONCEPT_PAGE,
    });
    // First call: entity match
    const entityInput = makeToolInput("Write", "/Users/hogers/Projects/koord/src/agent.ts");
    const entityResult = WikiContextInjector.execute(entityInput, deps);
    expect(entityResult.ok).toBe(true);
    if (entityResult.ok) {
      expect(getInjectedContextFor(entityResult.value, "PreToolUse")).toContain("koord");
    }

    // Second call: concept match (different file path to avoid dedup)
    const conceptInput = makeToolInput(
      "Edit",
      "/Users/hogers/Projects/design-first-methodology/plan.md",
    );
    const conceptResult = WikiContextInjector.execute(conceptInput, deps);
    expect(conceptResult.ok).toBe(true);
    if (conceptResult.ok) {
      expect(getInjectedContextFor(conceptResult.value, "PreToolUse")).toContain(
        "Design-first methodology",
      );
    }
  });
});

// ─── Dedup behavior ────────────────────────────────────────────────────────

describe("WikiContextInjector dedup", () => {
  const KOORD_PAGE = `---
title: "koord"
type: entity
domain: [koord]
---

## Summary
Multi-agent coordination system via Discord.

## Key Facts
- Some fact`;

  it("injects context on first call but skips on second call for same file", () => {
    const deps = makeDeps({
      readDir: (path: string) => {
        if (path.endsWith("/entities")) return ok(["koord.md"]);
        return ok([]);
      },
      readFile: () => ok(KOORD_PAGE),
    });
    const input = makeToolInput("Write", "/Users/hogers/Projects/koord/src/agent.ts");

    const first = WikiContextInjector.execute(input, deps);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(getInjectedContextFor(first.value, "PreToolUse")).toBeDefined();
    }

    const second = WikiContextInjector.execute(input, deps);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(getInjectedContextFor(second.value, "PreToolUse")).toBeUndefined();
    }
  });

  it("injects context for different files in the same domain", () => {
    const deps = makeDeps({
      readDir: (path: string) => {
        if (path.endsWith("/entities")) return ok(["koord.md"]);
        return ok([]);
      },
      readFile: () => ok(KOORD_PAGE),
    });

    const first = WikiContextInjector.execute(
      makeToolInput("Write", "/Users/hogers/Projects/koord/src/agent.ts"),
      deps,
    );
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(getInjectedContextFor(first.value, "PreToolUse")).toBeDefined();
    }

    const second = WikiContextInjector.execute(
      makeToolInput("Edit", "/Users/hogers/Projects/koord/src/daemon.ts"),
      deps,
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(getInjectedContextFor(second.value, "PreToolUse")).toBeDefined();
    }
  });
});

// ─── Injection metrics ─────────────────────────────────────────────────────

describe("WikiContextInjector metrics", () => {
  const KOORD_PAGE = `---
title: "koord"
type: entity
domain: [koord]
---

## Summary
Multi-agent coordination system via Discord.

## Key Facts
- Some fact`;

  it("appends injection metric on successful match", () => {
    const appendedLines: string[] = [];
    const deps = makeDeps({
      readDir: (path: string) => {
        if (path.endsWith("/entities")) return ok(["koord.md"]);
        return ok([]);
      },
      readFile: () => ok(KOORD_PAGE),
      appendFile: (_path: string, content: string) => {
        appendedLines.push(content);
        return ok(undefined);
      },
    });

    const input = makeToolInput("Write", "/Users/hogers/Projects/koord/src/agent.ts");
    WikiContextInjector.execute(input, deps);

    expect(appendedLines.length).toBe(1);
    const metric = JSON.parse(appendedLines[0].trim());
    expect(metric.type).toBe("injection");
    expect(metric.session_id).toBe("test-sess");
    expect(metric.file_path).toBe("/Users/hogers/Projects/koord/src/agent.ts");
    expect(metric.matched_pages).toEqual(["entities/koord.md"]);
    expect(metric.timestamp).toBeDefined();
  });

  it("does not append metric when no match", () => {
    const appendedLines: string[] = [];
    const deps = makeDeps({
      readDir: () => ok([]),
      appendFile: (_path: string, content: string) => {
        appendedLines.push(content);
        return ok(undefined);
      },
    });

    const input = makeToolInput("Write", "/Users/hogers/random/file.ts");
    WikiContextInjector.execute(input, deps);

    expect(appendedLines.length).toBe(0);
  });

  it("does not append metric on dedup skip", () => {
    const appendedLines: string[] = [];
    const deps = makeDeps({
      readDir: (path: string) => {
        if (path.endsWith("/entities")) return ok(["koord.md"]);
        return ok([]);
      },
      readFile: () => ok(KOORD_PAGE),
      appendFile: (_path: string, content: string) => {
        appendedLines.push(content);
        return ok(undefined);
      },
    });

    const input = makeToolInput("Write", "/Users/hogers/Projects/koord/src/agent.ts");
    WikiContextInjector.execute(input, deps);
    WikiContextInjector.execute(input, deps);

    expect(appendedLines.length).toBe(1);
  });
});
