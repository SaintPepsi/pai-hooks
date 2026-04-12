import { describe, expect, test } from "bun:test";

// ─── Helpers ────────────────────────────────────────────────────────────────

const SCRIPT_PATH = `${import.meta.dir}/type-signature.ts`;
const PAI_HOOKS_DIR = `${import.meta.dir}/../../../..`;

async function runCLI(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Bun.spawnSync stdout/stderr pipe capture is broken inside this project's
  // bun test runner — use temp files to capture output instead.
  const id = Math.random().toString(36).slice(2);
  const stdoutPath = `/tmp/type-sig-test-${id}.txt`;
  const stderrPath = `/tmp/type-sig-test-stderr-${id}.txt`;

  const bunPath = Bun.which("bun") ?? "bun";
  const proc = Bun.spawn([bunPath, SCRIPT_PATH, ...args], {
    cwd: import.meta.dir,
    stdout: Bun.file(stdoutPath),
    stderr: Bun.file(stderrPath),
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

function extractNameDiverseCount(output: string): number {
  const match = output.match(/Name-diverse clusters \(2\+ distinct names\):\s*(\d+)/);
  return match ? parseInt(match[1], 10) : -1;
}

function extractTotalClusterCount(output: string): number {
  const match = output.match(/Found (\d+) total clusters/);
  return match ? parseInt(match[1], 10) : -1;
}

// ─── CLI: missing directory argument ────────────────────────────────────────

describe("CLI: missing directory argument", () => {
  test("exits with code 1 when no args given", async () => {
    const { exitCode } = await runCLI([]);
    expect(exitCode).toBe(1);
  });

  test("stderr contains usage instructions when no args given", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("Usage:");
  });

  test("stderr usage mentions type-signature.ts", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("type-signature.ts");
  });
});

// ─── CLI: output structure on pai-hooks ─────────────────────────────────────

describe("CLI: pai-hooks output structure", () => {
  test("exits with code 0 for pai-hooks directory", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR]);
    expect(exitCode).toBe(0);
  });

  test("stdout contains correct header", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Type-Signature-Gated Similarity Clustering");
  });

  test("stdout contains Novelty Analysis section", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Novelty Analysis");
  });

  test("stdout contains Name-Diverse Clusters section header", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Name-Diverse Clusters");
  });

  test("stdout contains All Clusters section", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("All Clusters");
  });

  test("stdout contains scanned file and function counts", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Scanned: \d+ files, \d+ functions/);
  });

  test("stdout contains signature groups count", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Signature groups: \d+/);
  });

  test("stdout contains similarity clusters count", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Similarity clusters: \d+/);
  });
});

// ─── CLI: novelty analysis output ───────────────────────────────────────────

describe("CLI: novelty analysis content", () => {
  test("name-diverse cluster count is greater than 30", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const count = extractNameDiverseCount(stdout);
    expect(count).toBeGreaterThan(30);
  });

  test("stdout reports functions in name-diverse clusters", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Functions in name-diverse clusters: \d+/);
  });

  test("stdout mentions invisible to role-naming detectors", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("invisible to role-naming");
  });
});

// ─── CLI: signature format and body similarity ───────────────────────────────

describe("CLI: signature and similarity formatting", () => {
  test("parenthesized type signature with arrow appears in output", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    // Sig format: (type,type)→returnType  or (type)→returnType
    expect(stdout).toMatch(/\(.*\)→\w+/);
  });

  test("body similarity percentages appear in output", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    // e.g. "77% avg body sim" or "100% avg body sim"
    expect(stdout).toMatch(/\d+% avg body sim/);
  });

  test("member detail lines contain function name and line number", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const memberLines = stdout.split("\n").filter((l) => l.match(/^\s+- \w.+:\d+\)/));
    expect(memberLines.length).toBeGreaterThan(0);
  });
});

// ─── CLI: All Clusters section labels ────────────────────────────────────────

describe("CLI: All Clusters NAME-DIVERSE label", () => {
  test("[NAME-DIVERSE] label appears in All Clusters section", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const allClustersIdx = stdout.indexOf("--- All Clusters");
    expect(allClustersIdx).toBeGreaterThan(-1);
    const slice = stdout.slice(allClustersIdx);
    expect(slice).toContain("[NAME-DIVERSE]");
  });
});

// ─── CLI: stderr parse stats ─────────────────────────────────────────────────

describe("CLI: stderr parse stats", () => {
  test("stderr reports parsed file count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/Parsed \d+ files/);
  });

  test("stderr reports function count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/\d+ functions/);
  });

  test("stderr reports signature group count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/Found \d+ signature groups/);
  });

  test("stderr reports similarity cluster count with name-diverse count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/Found \d+ similarity clusters \(\d+ name-diverse\)/);
  });

  test("stderr reports parse time in ms", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/\d+ms/);
  });
});

// ─── CLI: --min-sim flag ──────────────────────────────────────────────────────

describe("CLI: --min-sim flag affects cluster count", () => {
  test("--min-sim 0.3 exits with code 0", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--min-sim", "0.3"]);
    expect(exitCode).toBe(0);
  });

  test("--min-sim 0.9 exits with code 0", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--min-sim", "0.9"]);
    expect(exitCode).toBe(0);
  });

  test("higher --min-sim produces more or equal clusters than lower --min-sim", async () => {
    // Union-find merges aggressively at low similarity thresholds (fewer, larger clusters).
    // At high thresholds fewer pairs qualify, keeping clusters separate (more, smaller clusters).
    const [{ stdout: outLow }, { stdout: outHigh }] = await Promise.all([
      runCLI([PAI_HOOKS_DIR, "--min-sim", "0.3"]),
      runCLI([PAI_HOOKS_DIR, "--min-sim", "0.9"]),
    ]);

    const countLow = extractTotalClusterCount(outLow);
    const countHigh = extractTotalClusterCount(outHigh);

    expect(countLow).toBeGreaterThanOrEqual(0);
    expect(countHigh).toBeGreaterThanOrEqual(0);
    expect(countHigh).toBeGreaterThanOrEqual(countLow);
  });
});

// ─── CLI: --min-group flag ────────────────────────────────────────────────────

describe("CLI: --min-group flag affects cluster count", () => {
  test("--min-group 2 exits with code 0", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--min-group", "2"]);
    expect(exitCode).toBe(0);
  });

  test("--min-group 10 exits with code 0", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--min-group", "10"]);
    expect(exitCode).toBe(0);
  });

  test("lower --min-group produces more or equal clusters than higher --min-group", async () => {
    const [{ stdout: outLow }, { stdout: outHigh }] = await Promise.all([
      runCLI([PAI_HOOKS_DIR, "--min-group", "2"]),
      runCLI([PAI_HOOKS_DIR, "--min-group", "10"]),
    ]);

    const countLow = extractTotalClusterCount(outLow);
    const countHigh = extractTotalClusterCount(outHigh);

    expect(countLow).toBeGreaterThanOrEqual(0);
    expect(countHigh).toBeGreaterThanOrEqual(0);
    expect(countLow).toBeGreaterThanOrEqual(countHigh);
  });
});
