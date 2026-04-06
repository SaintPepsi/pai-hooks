/**
 * WikiContextInjector Contract Tests
 *
 * Tests the pure functions (buildDomainIndex, matchDomain, extractSummary)
 * and the contract's accepts() and execute() methods.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { ok } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { makeToolInput } from "@hooks/lib/test-helpers";
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
      koord: [{ title: "Koord", path: "entities/koord.md", summary: "Multi-agent system." }],
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
      koord: [{ title: "Koord", path: "entities/koord.md", summary: "Multi-agent system." }],
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

  it("returns continue with additionalContext when domain matches", () => {
    const deps = makeDeps({
      readDir: () => ok(["koord.md"]),
      readFile: () => ok(KOORD_PAGE),
    });
    const input = makeToolInput("Write", "/Users/hogers/Projects/koord/src/agent.ts");
    const result = WikiContextInjector.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
      expect(result.value.additionalContext).toBeDefined();
      expect(result.value.additionalContext).toContain("koord");
      expect(result.value.additionalContext).toContain(
        "Multi-agent coordination system via Discord.",
      );
    }
  });

  it("returns plain continue when no domain matches", () => {
    const deps = makeDeps({
      readDir: () => ok(["koord.md"]),
      readFile: () => ok(KOORD_PAGE),
    });
    const input = makeToolInput("Edit", "/Users/hogers/unrelated-project/src/main.ts");
    const result = WikiContextInjector.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
      expect(result.value.additionalContext).toBeUndefined();
    }
  });

  it("returns plain continue when file_path is missing", () => {
    const deps = makeDeps({
      readDir: () => ok(["koord.md"]),
      readFile: () => ok(KOORD_PAGE),
    });
    const input: ToolHookInput = {
      session_id: "test-sess",
      tool_name: "Write",
      tool_input: {},
    };
    const result = WikiContextInjector.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.additionalContext).toBeUndefined();
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
      expect(result.value.additionalContext).toBeUndefined();
    }
  });
});
