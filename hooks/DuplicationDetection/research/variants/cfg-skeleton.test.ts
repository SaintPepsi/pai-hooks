import { describe, expect, test } from "bun:test";
import { parseDirectory } from "@tools/pattern-detector/parse";
import type { ParsedFile } from "@tools/pattern-detector/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

const SCRIPT_PATH = `${import.meta.dir}/cfg-skeleton.ts`;
const DETECTORS_DIR = `${import.meta.dir}/../detectors`;
const PATTERN_DETECTOR_DIR = `${import.meta.dir}/..`;
const PAI_HOOKS_DIR = `${import.meta.dir}/../../../..`;

async function runCLI(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Bun.spawnSync stdout/stderr pipe capture is broken inside this project's
  // bun test runner — use temp files to capture output instead.
  const id = Math.random().toString(36).slice(2);
  const stdoutPath = `/tmp/cfg-test-stdout-${id}.txt`;
  const stderrPath = `/tmp/cfg-test-stderr-${id}.txt`;

  const stdoutFile = Bun.file(stdoutPath);
  const stderrFile = Bun.file(stderrPath);

  const bunPath = Bun.which("bun") ?? "bun";
  const proc = Bun.spawn([bunPath, SCRIPT_PATH, ...args], {
    cwd: import.meta.dir,
    stdout: stdoutFile,
    stderr: stderrFile,
  });
  const exitCode = await proc.exited;

  const [stdout, stderr] = await Promise.all([
    Bun.file(stdoutPath)
      .text()
      .catch(() => ""),
    Bun.file(stderrPath)
      .text()
      .catch(() => ""),
  ]);

  return { stdout, stderr, exitCode };
}

function extractClusterCount(output: string, section: string): number {
  // Find the section header and extract "Found N cluster(s)" that follows it
  const sectionIdx = output.indexOf(`--- ${section} ---`);
  if (sectionIdx === -1) return -1;
  const slice = output.slice(sectionIdx, sectionIdx + 200);
  const match = slice.match(/Found (\d+) cluster\(s\)/);
  return match ? parseInt(match[1], 10) : -1;
}

// ─── Skeleton Logic (mirror of CLI internals for unit testing) ───────────────

const CONTROL_FLOW_NODES = new Set([
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "SwitchCase",
  "ReturnStatement",
  "ThrowStatement",
  "TryStatement",
  "CatchClause",
  "ConditionalExpression",
]);

const NESTING_NODES = new Set([
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "TryStatement",
  "BlockStatement",
]);

interface SkeletonNode {
  type: string;
  depth: number;
}

function extractSkeleton(nodeTypes: string[]): SkeletonNode[] {
  const skeleton: SkeletonNode[] = [];
  let depth = 0;

  for (let i = 0; i < nodeTypes.length; i++) {
    const t = nodeTypes[i];

    if (t === "BlockStatement") {
      if (i > 0 && NESTING_NODES.has(nodeTypes[i - 1])) {
        depth++;
      }
    }

    if (CONTROL_FLOW_NODES.has(t)) {
      skeleton.push({ type: t, depth: Math.min(depth, 10) });
    }
  }

  return skeleton;
}

function skeletonFingerprint(skeleton: SkeletonNode[]): string {
  return skeleton.map((n) => `${n.type}@${n.depth}`).join("→");
}

function compressedFingerprint(skeleton: SkeletonNode[]): string {
  return skeleton.map((n) => n.type).join("→");
}

function shapeFingerprint(skeleton: SkeletonNode[]): string {
  const pairs = new Set(skeleton.map((n) => `${n.type}@${n.depth}`));
  return [...pairs].sort().join("|");
}

function abbreviatedFingerprint(skeleton: SkeletonNode[]): string {
  if (skeleton.length === 0) return "";
  const parts: string[] = [];
  let current = skeleton[0].type;
  let count = 1;

  for (let i = 1; i < skeleton.length; i++) {
    if (skeleton[i].type === current) {
      count++;
    } else {
      parts.push(count > 1 ? `${current}(${count})` : current);
      current = skeleton[i].type;
      count = 1;
    }
  }
  parts.push(count > 1 ? `${current}(${count})` : current);
  return parts.join("→");
}

// ─── extractSkeleton Unit Tests ──────────────────────────────────────────────

describe("extractSkeleton", () => {
  test("returns empty array for empty input", () => {
    expect(extractSkeleton([])).toEqual([]);
  });

  test("returns empty array for nodes with no control flow", () => {
    const result = extractSkeleton(["Identifier", "CallExpression", "MemberExpression"]);
    expect(result).toEqual([]);
  });

  test("extracts IfStatement at depth 0", () => {
    const result = extractSkeleton(["IfStatement"]);
    expect(result).toEqual([{ type: "IfStatement", depth: 0 }]);
  });

  test("extracts multiple control flow nodes in sequence", () => {
    const result = extractSkeleton(["IfStatement", "ReturnStatement", "ForStatement"]);
    expect(result.length).toBe(3);
    expect(result[0].type).toBe("IfStatement");
    expect(result[1].type).toBe("ReturnStatement");
    expect(result[2].type).toBe("ForStatement");
  });

  test("depth increments when BlockStatement follows a nesting node", () => {
    const result = extractSkeleton(["IfStatement", "BlockStatement", "ReturnStatement"]);
    // After IfStatement + BlockStatement, depth becomes 1; ReturnStatement is at depth 1
    expect(result.find((n) => n.type === "ReturnStatement")?.depth).toBe(1);
  });

  test("depth stays 0 when BlockStatement is not preceded by a nesting node", () => {
    const result = extractSkeleton(["BlockStatement", "ReturnStatement"]);
    expect(result.find((n) => n.type === "ReturnStatement")?.depth).toBe(0);
  });

  test("caps depth at 10 for deeply nested structures", () => {
    // Build a deeply nested sequence: repeat IfStatement+BlockStatement many times
    const types: string[] = [];
    for (let i = 0; i < 15; i++) {
      types.push("IfStatement", "BlockStatement");
    }
    types.push("ReturnStatement");
    const result = extractSkeleton(types);
    const returnNode = result.find((n) => n.type === "ReturnStatement");
    expect(returnNode?.depth).toBeLessThanOrEqual(10);
  });

  test("ConditionalExpression (ternary) is treated as control flow", () => {
    const result = extractSkeleton(["ConditionalExpression"]);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("ConditionalExpression");
  });

  test("non-control-flow nodes are filtered out", () => {
    const result = extractSkeleton([
      "VariableDeclaration",
      "ExpressionStatement",
      "CallExpression",
      "IfStatement",
      "Identifier",
    ]);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("IfStatement");
  });
});

// ─── Fingerprint Function Unit Tests ────────────────────────────────────────

describe("skeletonFingerprint", () => {
  test("returns empty string for empty skeleton", () => {
    expect(skeletonFingerprint([])).toBe("");
  });

  test("formats as type@depth joined by arrows", () => {
    const skeleton: SkeletonNode[] = [
      { type: "IfStatement", depth: 0 },
      { type: "ReturnStatement", depth: 1 },
    ];
    expect(skeletonFingerprint(skeleton)).toBe("IfStatement@0→ReturnStatement@1");
  });

  test("two skeletons with same types but different depths produce different fingerprints", () => {
    const a: SkeletonNode[] = [{ type: "ReturnStatement", depth: 0 }];
    const b: SkeletonNode[] = [{ type: "ReturnStatement", depth: 1 }];
    expect(skeletonFingerprint(a)).not.toBe(skeletonFingerprint(b));
  });
});

describe("compressedFingerprint", () => {
  test("returns empty string for empty skeleton", () => {
    expect(compressedFingerprint([])).toBe("");
  });

  test("uses only type, ignoring depth", () => {
    const a: SkeletonNode[] = [{ type: "IfStatement", depth: 0 }];
    const b: SkeletonNode[] = [{ type: "IfStatement", depth: 3 }];
    expect(compressedFingerprint(a)).toBe(compressedFingerprint(b));
  });

  test("joins types with arrows", () => {
    const skeleton: SkeletonNode[] = [
      { type: "IfStatement", depth: 0 },
      { type: "ForStatement", depth: 1 },
      { type: "ReturnStatement", depth: 2 },
    ];
    expect(compressedFingerprint(skeleton)).toBe("IfStatement→ForStatement→ReturnStatement");
  });
});

describe("shapeFingerprint", () => {
  test("returns empty string for empty skeleton", () => {
    expect(shapeFingerprint([])).toBe("");
  });

  test("deduplicates repeated type@depth pairs", () => {
    const skeleton: SkeletonNode[] = [
      { type: "ReturnStatement", depth: 1 },
      { type: "ReturnStatement", depth: 1 },
      { type: "IfStatement", depth: 0 },
    ];
    const result = shapeFingerprint(skeleton);
    // Should have exactly two unique pairs
    expect(result.split("|").length).toBe(2);
  });

  test("result is sorted alphabetically", () => {
    const skeleton: SkeletonNode[] = [
      { type: "ReturnStatement", depth: 0 },
      { type: "IfStatement", depth: 0 },
    ];
    const result = shapeFingerprint(skeleton);
    const parts = result.split("|");
    expect(parts).toEqual([...parts].sort());
  });

  test("same shape in different order produces same fingerprint", () => {
    const a: SkeletonNode[] = [
      { type: "IfStatement", depth: 0 },
      { type: "ReturnStatement", depth: 1 },
    ];
    const b: SkeletonNode[] = [
      { type: "ReturnStatement", depth: 1 },
      { type: "IfStatement", depth: 0 },
    ];
    expect(shapeFingerprint(a)).toBe(shapeFingerprint(b));
  });
});

describe("abbreviatedFingerprint", () => {
  test("returns empty string for empty skeleton", () => {
    expect(abbreviatedFingerprint([])).toBe("");
  });

  test("single node returns just the type", () => {
    const skeleton: SkeletonNode[] = [{ type: "ReturnStatement", depth: 0 }];
    expect(abbreviatedFingerprint(skeleton)).toBe("ReturnStatement");
  });

  test("consecutive same types are collapsed with count", () => {
    const skeleton: SkeletonNode[] = [
      { type: "IfStatement", depth: 0 },
      { type: "IfStatement", depth: 0 },
      { type: "ReturnStatement", depth: 1 },
    ];
    expect(abbreviatedFingerprint(skeleton)).toBe("IfStatement(2)→ReturnStatement");
  });

  test("non-consecutive repetitions are not collapsed", () => {
    const skeleton: SkeletonNode[] = [
      { type: "IfStatement", depth: 0 },
      { type: "ReturnStatement", depth: 1 },
      { type: "IfStatement", depth: 0 },
    ];
    // Each IfStatement appears separately — not consecutive
    expect(abbreviatedFingerprint(skeleton)).toBe("IfStatement→ReturnStatement→IfStatement");
  });

  test("three consecutive same types show correct count", () => {
    const skeleton: SkeletonNode[] = [
      { type: "ReturnStatement", depth: 1 },
      { type: "ReturnStatement", depth: 1 },
      { type: "ReturnStatement", depth: 1 },
    ];
    expect(abbreviatedFingerprint(skeleton)).toBe("ReturnStatement(3)");
  });

  test("single node in sequence is not annotated with count", () => {
    const skeleton: SkeletonNode[] = [
      { type: "IfStatement", depth: 0 },
      { type: "ForStatement", depth: 0 },
    ];
    const result = abbreviatedFingerprint(skeleton);
    expect(result).not.toContain("(1)");
  });
});

// ─── Parse Integration ───────────────────────────────────────────────────────

describe("parseDirectory integration", () => {
  test("returns parsed files with functions for detectors directory", () => {
    const files: ParsedFile[] = parseDirectory(DETECTORS_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.functions.length).toBeGreaterThan(0);
      expect(f.path).toMatch(/\.ts$/);
    }
  });

  test("each parsed function has bodyNodeTypes array", () => {
    const files: ParsedFile[] = parseDirectory(DETECTORS_DIR);
    for (const f of files) {
      for (const fn of f.functions) {
        expect(Array.isArray(fn.bodyNodeTypes)).toBe(true);
        expect(typeof fn.name).toBe("string");
        expect(typeof fn.file).toBe("string");
        expect(typeof fn.line).toBe("number");
      }
    }
  });

  test("skeletons can be extracted from real function body types", () => {
    const files: ParsedFile[] = parseDirectory(DETECTORS_DIR);
    const functionsWithNodes = files
      .flatMap((f) => f.functions)
      .filter((fn) => fn.bodyNodeTypes.length >= 2);
    expect(functionsWithNodes.length).toBeGreaterThan(0);

    for (const fn of functionsWithNodes.slice(0, 5)) {
      const skeleton = extractSkeleton(fn.bodyNodeTypes);
      expect(Array.isArray(skeleton)).toBe(true);
      for (const node of skeleton) {
        expect(CONTROL_FLOW_NODES.has(node.type)).toBe(true);
        expect(node.depth).toBeGreaterThanOrEqual(0);
        expect(node.depth).toBeLessThanOrEqual(10);
      }
    }
  });
});

// ─── CLI Integration Tests ───────────────────────────────────────────────────

describe("CLI: missing directory argument", () => {
  test("exits with code 1 when no directory provided", async () => {
    const { exitCode } = await runCLI([]);
    expect(exitCode).toBe(1);
  });

  test("stderr contains usage instructions when no args given", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("Usage:");
  });

  test("stderr usage mentions cfg-skeleton.ts", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("cfg-skeleton.ts");
  });
});

describe("CLI: valid directory output structure", () => {
  test("exits with code 0 for valid directory", async () => {
    const { exitCode } = await runCLI([DETECTORS_DIR]);
    expect(exitCode).toBe(0);
  });

  test("stdout contains CFG Skeleton Fingerprinting header", async () => {
    const { stdout } = await runCLI([DETECTORS_DIR]);
    expect(stdout).toContain("CFG Skeleton Fingerprinting");
  });

  test("stdout contains file and function counts", async () => {
    const { stdout } = await runCLI([DETECTORS_DIR]);
    expect(stdout).toMatch(/Scanned: \d+ files, \d+ functions/);
  });

  test("stdout contains Full Skeleton strategy section", async () => {
    const { stdout } = await runCLI([DETECTORS_DIR]);
    expect(stdout).toContain("Full Skeleton");
  });

  test("stdout contains Compressed strategy section", async () => {
    const { stdout } = await runCLI([DETECTORS_DIR]);
    expect(stdout).toContain("Compressed");
  });

  test("stdout contains Shape strategy section", async () => {
    const { stdout } = await runCLI([DETECTORS_DIR]);
    expect(stdout).toContain("Shape");
  });

  test("stdout contains Abbreviated strategy section", async () => {
    const { stdout } = await runCLI([DETECTORS_DIR]);
    expect(stdout).toContain("Abbreviated");
  });

  test("each strategy section shows cluster count", async () => {
    const { stdout } = await runCLI([DETECTORS_DIR]);
    const matches = [...stdout.matchAll(/Found \d+ cluster\(s\)/g)];
    // Four strategies, each should report cluster count
    expect(matches.length).toBe(4);
  });
});

describe("CLI: stderr parse stats", () => {
  test("stderr reports parsed file count", async () => {
    const { stderr } = await runCLI([DETECTORS_DIR]);
    expect(stderr).toMatch(/Parsed \d+ files/);
  });

  test("stderr reports function count", async () => {
    const { stderr } = await runCLI([DETECTORS_DIR]);
    expect(stderr).toMatch(/\d+ functions/);
  });

  test("stderr reports parse time in ms", async () => {
    const { stderr } = await runCLI([DETECTORS_DIR]);
    expect(stderr).toMatch(/\d+ms/);
  });

  test("stderr reports avg skeleton length", async () => {
    const { stderr } = await runCLI([DETECTORS_DIR]);
    expect(stderr).toMatch(/Avg skeleton length:/);
  });

  test("stderr reports total clusters across all strategies", async () => {
    const { stderr } = await runCLI([DETECTORS_DIR]);
    expect(stderr).toMatch(/Total clusters across all strategies: \d+/);
  });
});

describe("CLI: --min-depth flag", () => {
  test("--min-depth 0 exits successfully", async () => {
    const { exitCode } = await runCLI([
      PATTERN_DETECTOR_DIR,
      "--min-depth",
      "0",
      "--min-members",
      "2",
    ]);
    expect(exitCode).toBe(0);
  });

  test("--min-depth 5 exits successfully", async () => {
    const { exitCode } = await runCLI([
      PATTERN_DETECTOR_DIR,
      "--min-depth",
      "5",
      "--min-members",
      "2",
    ]);
    expect(exitCode).toBe(0);
  });

  test("lower min-depth produces more or equal clusters than higher min-depth (Full Skeleton)", async () => {
    const [{ stdout: outLow }, { stdout: outHigh }] = await Promise.all([
      runCLI([PATTERN_DETECTOR_DIR, "--min-depth", "0", "--min-members", "2"]),
      runCLI([PATTERN_DETECTOR_DIR, "--min-depth", "5", "--min-members", "2"]),
    ]);

    const countLow = extractClusterCount(outLow, "Full Skeleton (type@depth sequence)");
    const countHigh = extractClusterCount(outHigh, "Full Skeleton (type@depth sequence)");

    expect(countLow).toBeGreaterThanOrEqual(0);
    expect(countHigh).toBeGreaterThanOrEqual(0);
    expect(countLow).toBeGreaterThanOrEqual(countHigh);
  });
});

describe("CLI: --min-members flag", () => {
  test("--min-members 2 exits successfully", async () => {
    const { exitCode } = await runCLI([PATTERN_DETECTOR_DIR, "--min-members", "2"]);
    expect(exitCode).toBe(0);
  });

  test("--min-members 10 exits successfully", async () => {
    const { exitCode } = await runCLI([PATTERN_DETECTOR_DIR, "--min-members", "10"]);
    expect(exitCode).toBe(0);
  });

  test("lower min-members produces more or equal clusters than higher min-members", async () => {
    const [{ stdout: outLow }, { stdout: outHigh }] = await Promise.all([
      runCLI([PATTERN_DETECTOR_DIR, "--min-members", "2"]),
      runCLI([PATTERN_DETECTOR_DIR, "--min-members", "10"]),
    ]);

    const countLow = extractClusterCount(outLow, "Full Skeleton (type@depth sequence)");
    const countHigh = extractClusterCount(outHigh, "Full Skeleton (type@depth sequence)");

    expect(countLow).toBeGreaterThanOrEqual(0);
    expect(countHigh).toBeGreaterThanOrEqual(0);
    expect(countLow).toBeGreaterThanOrEqual(countHigh);
  });
});

describe("CLI: pai-hooks codebase scan", () => {
  test("scans pai-hooks and exits with code 0", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--min-members", "2"]);
    expect(exitCode).toBe(0);
  });

  test("scans pai-hooks and produces CFG Skeleton header", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR, "--min-members", "2"]);
    expect(stdout).toContain("CFG Skeleton Fingerprinting");
  });

  test("scans pai-hooks and finds at least one cluster with member details", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR, "--min-depth", "0", "--min-members", "2"]);
    // Member detail lines start with "    - functionName (path:line)"
    const memberLines = stdout.split("\n").filter((l) => l.match(/^\s+- \w.+:\d+\)/));
    expect(memberLines.length).toBeGreaterThan(0);
  });

  test("member detail lines contain filename and line number", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR, "--min-depth", "0", "--min-members", "2"]);
    const memberLines = stdout.split("\n").filter((l) => l.match(/^\s+- .+:\d+\)/));
    if (memberLines.length > 0) {
      // Each member line should have format: "    - fnName (path:line)"
      expect(memberLines[0]).toMatch(/- .+ \(.+:\d+\)/);
    }
  });

  test("stderr reports parse stats for pai-hooks", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR, "--min-members", "2"]);
    expect(stderr).toMatch(/Parsed \d+ files \(\d+ functions\) in \d+ms/);
  });
});
