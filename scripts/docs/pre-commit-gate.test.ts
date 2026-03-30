import { describe, expect, it } from "bun:test";
import type { GateConfig, GateDeps, GateIssue } from "./pre-commit-gate";
import { checkDocGate, formatReport } from "./pre-commit-gate";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<GateDeps> = {}): GateDeps {
  return {
    fileExists: () => true,
    scanHookJsons: () => [],
    ...overrides,
  };
}

const config: GateConfig = {
  hooksDir: "/repo/hooks",
  docsDir: "/repo/docs/groups",
};

// ─── checkDocGate ────────────────────────────────────────────────────────────

describe("checkDocGate", () => {
  it("returns empty when all docs and HTML exist", () => {
    const deps = makeDeps({
      scanHookJsons: () => ["GitSafety/MergeGate/hook.json"],
      fileExists: () => true,
    });

    const issues = checkDocGate(config, deps);
    expect(issues).toEqual([]);
  });

  it("detects missing doc.md", () => {
    const deps = makeDeps({
      scanHookJsons: () => ["GitSafety/MergeGate/hook.json"],
      fileExists: (path: string) => !path.endsWith("doc.md"),
    });

    const issues = checkDocGate(config, deps);
    expect(issues).toEqual([
      {
        hookDir: "/repo/hooks/GitSafety/MergeGate",
        hookName: "MergeGate",
        groupName: "GitSafety",
        type: "missing-doc",
      },
    ]);
  });

  it("detects missing HTML", () => {
    const deps = makeDeps({
      scanHookJsons: () => ["GitSafety/MergeGate/hook.json"],
      fileExists: (path: string) => !path.endsWith(".html"),
    });

    const issues = checkDocGate(config, deps);
    expect(issues).toEqual([
      {
        hookDir: "/repo/hooks/GitSafety/MergeGate",
        hookName: "MergeGate",
        groupName: "GitSafety",
        type: "missing-html",
      },
    ]);
  });

  it("detects both missing doc.md and HTML", () => {
    const deps = makeDeps({
      scanHookJsons: () => ["GitSafety/MergeGate/hook.json"],
      fileExists: () => false,
    });

    const issues = checkDocGate(config, deps);
    expect(issues).toHaveLength(2);
    expect(issues[0].type).toBe("missing-doc");
    expect(issues[1].type).toBe("missing-html");
  });

  it("handles multiple hooks across groups", () => {
    const deps = makeDeps({
      scanHookJsons: () => [
        "GitSafety/MergeGate/hook.json",
        "CodeQuality/Linter/hook.json",
      ],
      fileExists: () => false,
    });

    const issues = checkDocGate(config, deps);
    expect(issues).toHaveLength(4);
    expect(issues.filter((i) => i.groupName === "GitSafety")).toHaveLength(2);
    expect(issues.filter((i) => i.groupName === "CodeQuality")).toHaveLength(2);
  });

  it("returns empty when no hook.json files found", () => {
    const deps = makeDeps({ scanHookJsons: () => [] });

    const issues = checkDocGate(config, deps);
    expect(issues).toEqual([]);
  });
});

// ─── formatReport ────────────────────────────────────────────────────────────

describe("formatReport", () => {
  it("returns empty string for no issues", () => {
    expect(formatReport([])).toBe("");
  });

  it("formats missing doc.md errors", () => {
    const issues: GateIssue[] = [
      {
        hookDir: "/repo/hooks/Git/Guard",
        hookName: "Guard",
        groupName: "Git",
        type: "missing-doc",
      },
    ];

    const report = formatReport(issues);
    expect(report).toContain("ERROR: Missing doc.md in /repo/hooks/Git/Guard/");
    expect(report).toContain("Pre-commit blocked");
  });

  it("formats missing HTML errors with render hint", () => {
    const issues: GateIssue[] = [
      {
        hookDir: "/repo/hooks/Git/Guard",
        hookName: "Guard",
        groupName: "Git",
        type: "missing-html",
      },
    ];

    const report = formatReport(issues);
    expect(report).toContain("ERROR: Missing docs/groups/Git/Guard.html");
    expect(report).toContain("Run: bun run docs:render");
  });

  it("groups doc errors before HTML errors", () => {
    const issues: GateIssue[] = [
      {
        hookDir: "/repo/hooks/A/B",
        hookName: "B",
        groupName: "A",
        type: "missing-html",
      },
      {
        hookDir: "/repo/hooks/C/D",
        hookName: "D",
        groupName: "C",
        type: "missing-doc",
      },
    ];

    const report = formatReport(issues);
    const docPos = report.indexOf("Missing doc.md");
    const htmlPos = report.indexOf("Missing docs/groups");
    expect(docPos).toBeLessThan(htmlPos);
  });
});
