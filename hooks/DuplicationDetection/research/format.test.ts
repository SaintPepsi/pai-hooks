import { describe, expect, test } from "bun:test";
import { formatClusters, formatSummary } from "@tools/pattern-detector/format";
import type { Cluster } from "@tools/pattern-detector/types";

function makeCluster(overrides: Partial<Cluster> = {}): Cluster {
  return {
    id: "import:00000001",
    detector: "import",
    label: "shared:react",
    confidence: 0.9,
    members: [
      {
        file: "/home/user/src/a.ts",
        functionName: "fnA",
        line: 10,
        evidence: ["shared import: react"],
      },
      {
        file: "/home/user/src/b.ts",
        functionName: "fnB",
        line: 20,
        evidence: ["shared import: react"],
      },
    ],
    reason: "2 functions share 1 import(s): react",
    ...overrides,
  };
}

describe("formatClusters", () => {
  test("returns 'No clusters detected.' for empty array", () => {
    const result = formatClusters([]);
    expect(result).toContain("No clusters detected.");
  });

  test("includes cluster label in output", () => {
    const cluster = makeCluster({ label: "shared:react+lodash" });
    const result = formatClusters([cluster], { homeDir: "/home/user" });
    expect(result).toContain("shared:react+lodash");
  });

  test("includes cluster id in output", () => {
    const cluster = makeCluster({ id: "import:deadbeef" });
    const result = formatClusters([cluster], { homeDir: "/home/user" });
    expect(result).toContain("import:deadbeef");
  });

  test("includes confidence percentage in output", () => {
    const cluster = makeCluster({ confidence: 0.75 });
    const result = formatClusters([cluster], { homeDir: "/home/user" });
    expect(result).toContain("75%");
  });

  test("includes reason in output", () => {
    const cluster = makeCluster({ reason: "3 functions share 2 import(s): react, lodash" });
    const result = formatClusters([cluster], { homeDir: "/home/user" });
    expect(result).toContain("3 functions share 2 import(s)");
  });

  test("includes function names from members", () => {
    const result = formatClusters([makeCluster()], { homeDir: "/home/user" });
    expect(result).toContain("fnA");
    expect(result).toContain("fnB");
  });

  test("groups output by detector type", () => {
    const clusters = [
      makeCluster({ detector: "import", id: "import:aaa", label: "shared:react" }),
      makeCluster({
        detector: "structural",
        id: "structural:bbb",
        label: "Structural match: fn1, fn2",
        confidence: 1.0,
      }),
    ];
    const result = formatClusters(clusters, { homeDir: "/home/user" });
    expect(result).toContain("Detector A");
    expect(result).toContain("Detector B");
  });

  test("shows correct detector header for import detector", () => {
    const result = formatClusters([makeCluster({ detector: "import" })], { homeDir: "/home/user" });
    expect(result).toContain("Detector A: Import + Signature Fingerprinting");
  });

  test("shows correct detector header for structural detector", () => {
    const result = formatClusters([makeCluster({ detector: "structural", id: "structural:x" })], {
      homeDir: "/home/user",
    });
    expect(result).toContain("Detector B: Structural Hash Bucketing");
  });

  test("shows correct detector header for layered detector", () => {
    const result = formatClusters([makeCluster({ detector: "layered", id: "layered:x" })], {
      homeDir: "/home/user",
    });
    expect(result).toContain("Detector C: Layered");
  });

  test("shortens path when it starts with homeDir", () => {
    const cluster = makeCluster();
    // members have file: /home/user/src/a.ts
    const result = formatClusters([cluster], { homeDir: "/home/user" });
    expect(result).toContain("~/src/a.ts");
    expect(result).not.toContain("/home/user/src/a.ts");
  });

  test("does not shorten path when it does not start with homeDir", () => {
    const cluster = makeCluster({
      members: [
        {
          file: "/other/project/file.ts",
          functionName: "externalFn",
          line: 5,
          evidence: [],
        },
        {
          file: "/other/project/file2.ts",
          functionName: "externalFn2",
          line: 6,
          evidence: [],
        },
      ],
    });
    const result = formatClusters([cluster], { homeDir: "/home/user" });
    expect(result).toContain("/other/project/file.ts");
  });

  test("empty homeDir leaves path unchanged", () => {
    const cluster = makeCluster();
    const result = formatClusters([cluster], { homeDir: "" });
    expect(result).toContain("/home/user/src/a.ts");
  });

  test("includes evidence for members that have it", () => {
    const result = formatClusters([makeCluster()], { homeDir: "/home/user" });
    expect(result).toContain("shared import: react");
  });

  test("multiple clusters under same detector are all listed", () => {
    const c1 = makeCluster({ id: "import:001", label: "shared:react" });
    const c2 = makeCluster({ id: "import:002", label: "shared:lodash" });
    const result = formatClusters([c1, c2], { homeDir: "/home/user" });
    expect(result).toContain("shared:react");
    expect(result).toContain("shared:lodash");
    // Only one Detector A header
    expect(result.split("Detector A").length - 1).toBe(1);
  });
});

describe("formatSummary", () => {
  test("includes file count", () => {
    const result = formatSummary([], 10, 5, 20);
    expect(result).toContain("5 files");
  });

  test("includes function count", () => {
    const result = formatSummary([], 10, 5, 20);
    expect(result).toContain("20 functions");
  });

  test("includes parse time", () => {
    const result = formatSummary([], 123, 5, 20);
    expect(result).toContain("123ms");
  });

  test("includes total cluster count", () => {
    const clusters = [makeCluster(), makeCluster({ id: "import:002" })];
    const result = formatSummary(clusters, 10, 3, 15);
    expect(result).toContain("Total clusters: 2");
  });

  test("shows zero clusters when none provided", () => {
    const result = formatSummary([], 10, 2, 8);
    expect(result).toContain("Total clusters: 0");
  });

  test("includes per-detector breakdown when clusters present", () => {
    const clusters = [
      makeCluster({ detector: "import" }),
      makeCluster({ detector: "structural", id: "structural:x" }),
    ];
    const result = formatSummary(clusters, 50, 4, 10);
    expect(result).toContain("Detector A");
    expect(result).toContain("Detector B");
  });

  test("reports correct count per detector", () => {
    const clusters = [
      makeCluster({ detector: "import", id: "import:1" }),
      makeCluster({ detector: "import", id: "import:2" }),
      makeCluster({ detector: "structural", id: "structural:1" }),
    ];
    const result = formatSummary(clusters, 10, 3, 12);
    expect(result).toMatch(/Detector A.*2 cluster/s);
    expect(result).toMatch(/Detector B.*1 cluster/s);
  });

  test("includes title header", () => {
    const result = formatSummary([], 0, 0, 0);
    expect(result).toContain("Pattern Duplication Detector");
  });

  test("parse time rounds to integer ms", () => {
    const result = formatSummary([], 99.6, 1, 1);
    expect(result).toContain("100ms");
  });
});

// ─── Research Adapters ──────────────────────────────────────────────────────

describe("existsSafe", () => {
  // Importing dynamically to avoid polluting the main import block
  const { existsSafe } = require("@hooks/hooks/DuplicationDetection/research/adapters");

  test("returns true for existing path", () => {
    expect(existsSafe("/tmp")).toBe(true);
  });

  test("returns false for missing path", () => {
    expect(existsSafe("/tmp/pai-nonexistent-xyz-check")).toBe(false);
  });
});
