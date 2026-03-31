import { describe, expect, test } from "bun:test";

// ─── Helpers ────────────────────────────────────────────────────────────────

const SCRIPT_PATH = import.meta.dir + "/role-naming.ts";
const PAI_HOOKS_DIR = "/Users/ian.hogers/.claude/pai-hooks";

async function runCLI(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Bun.spawnSync stdout/stderr pipe capture is broken inside this project's
  // bun test runner — use temp files to capture output instead.
  const id = Math.random().toString(36).slice(2);
  const stdoutPath = `/tmp/role-naming-test-${id}.txt`;
  const stderrPath = `/tmp/role-naming-test-stderr-${id}.txt`;

  const stdoutFile = Bun.file(stdoutPath);
  const stderrFile = Bun.file(stderrPath);

  const proc = Bun.spawn(["/Users/ian.hogers/.bun/bin/bun", SCRIPT_PATH, ...args], {
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

// ─── CLI: No Arguments ───────────────────────────────────────────────────────

describe("CLI: missing directory argument", () => {
  test("exits with code 1 when no directory provided", async () => {
    const { exitCode } = await runCLI([]);
    expect(exitCode).toBe(1);
  });

  test("stderr contains usage string when no args", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("Usage:");
  });

  test("stderr contains role-naming script name in usage", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("role-naming.ts");
  });

  test("stderr contains --min-instances flag in usage", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("--min-instances");
  });

  test("stderr contains --min-files flag in usage", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("--min-files");
  });
});

// ─── CLI: Output Header ──────────────────────────────────────────────────────

describe("CLI: output header and structure against pai-hooks", () => {
  test("exits with code 0 for valid directory", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR]);
    expect(exitCode).toBe(0);
  });

  test("stdout contains Role-Based Name Clustering header", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Role-Based Name Clustering");
  });

  test("stdout contains Cycle 3 annotation", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Cycle 3");
  });

  test("stdout contains scanned file and function counts", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Scanned: \d+ files, \d+ functions/);
  });

  test("stderr reports parsed file count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/Parsed \d+ files/);
  });

  test("stderr reports exact-name cluster and role cluster counts", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/\d+ exact-name clusters, \d+ role clusters/);
  });
});

// ─── CLI: All Three Sections Present ─────────────────────────────────────────

describe("CLI: three required output sections", () => {
  test("stdout contains Architectural Verb Distribution section", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Architectural Verb Distribution");
  });

  test("stdout contains Exact Name Clusters section", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Exact Name Clusters");
  });

  test("stdout contains Role Clusters section", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Role Clusters");
  });

  test("exact name clusters section has Found N clusters line", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Found \d+ clusters/);
  });
});

// ─── CLI: makeDeps Cluster ───────────────────────────────────────────────────

describe("CLI: makeDeps cluster appears in pai-hooks output", () => {
  test("stdout contains makeDeps function name", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("makeDeps");
  });

  test("makeDeps is classified as factory verb", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("makeDeps [factory]");
  });

  test("makeDeps has multiple instances across multiple files", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const match = stdout.match(/makeDeps \[factory\] — (\d+) instances across (\d+) files/);
    expect(match).not.toBeNull();
    const instances = parseInt(match![1], 10);
    const files = parseInt(match![2], 10);
    expect(instances).toBeGreaterThanOrEqual(30);
    expect(files).toBeGreaterThanOrEqual(30);
  });

  test("makeDeps cluster is structurally validated (high body sim)", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/makeDeps \[factory\] — .+validated/);
  });
});

// ─── CLI: makeInput Cluster ──────────────────────────────────────────────────

describe("CLI: makeInput cluster appears in pai-hooks output", () => {
  test("stdout contains makeInput function name", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("makeInput");
  });

  test("makeInput is classified as factory verb", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("makeInput [factory]");
  });

  test("makeInput has multiple instances across multiple files", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const match = stdout.match(/makeInput \[factory\] — (\d+) instances across (\d+) files/);
    expect(match).not.toBeNull();
    const instances = parseInt(match![1], 10);
    expect(instances).toBeGreaterThanOrEqual(10);
  });
});

// ─── CLI: Verb Distribution Categories ───────────────────────────────────────

describe("CLI: verb distribution shows expected categories", () => {
  test("factory verb appears in distribution", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("factory");
  });

  test("accessor verb appears in distribution", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("accessor");
  });

  test("predicate verb appears in distribution", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("predicate");
  });

  test("verb distribution shows total and clustered counts with percentages", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/\d+ total, \d+ clustered \(\d+%\)/);
  });

  test("factory verb shows top roles including deps", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("deps");
  });
});

// ─── CLI: --min-instances flag affects cluster count ─────────────────────────

describe("CLI: --min-instances flag affects cluster count", () => {
  test("higher min-instances produces fewer or equal exact clusters", async () => {
    const [{ stdout: outLow }, { stdout: outHigh }] = await Promise.all([
      runCLI([PAI_HOOKS_DIR, "--min-instances", "3"]),
      runCLI([PAI_HOOKS_DIR, "--min-instances", "10"]),
    ]);

    const extractExactCount = (out: string): number => {
      // Match the first "Found N clusters" (exact name section)
      const match = out.match(/Exact Name Clusters[^]*?Found (\d+) clusters/);
      return match ? parseInt(match[1], 10) : 0;
    };

    expect(extractExactCount(outLow)).toBeGreaterThan(extractExactCount(outHigh));
  });

  test("very high min-instances (999) produces zero exact clusters", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR, "--min-instances", "999"]);
    const match = stdout.match(/Exact Name Clusters[^]*?Found (\d+) clusters/);
    const count = match ? parseInt(match[1], 10) : 0;
    expect(count).toBe(0);
  });

  test("--min-instances 3 exits successfully", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--min-instances", "3"]);
    expect(exitCode).toBe(0);
  });
});

// ─── CLI: --min-files flag affects cluster count ──────────────────────────────

describe("CLI: --min-files flag affects cluster count", () => {
  test("higher min-files produces fewer or equal clusters", async () => {
    const [{ stdout: outLow }, { stdout: outHigh }] = await Promise.all([
      runCLI([PAI_HOOKS_DIR, "--min-files", "2"]),
      runCLI([PAI_HOOKS_DIR, "--min-files", "5"]),
    ]);

    const extractExactCount = (out: string): number => {
      const match = out.match(/Exact Name Clusters[^]*?Found (\d+) clusters/);
      return match ? parseInt(match[1], 10) : 0;
    };

    expect(extractExactCount(outLow)).toBeGreaterThanOrEqual(extractExactCount(outHigh));
  });

  test("very high min-files (999) produces zero exact clusters", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR, "--min-files", "999"]);
    const match = stdout.match(/Exact Name Clusters[^]*?Found (\d+) clusters/);
    const count = match ? parseInt(match[1], 10) : 0;
    expect(count).toBe(0);
  });

  test("--min-files 2 exits successfully", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--min-files", "2"]);
    expect(exitCode).toBe(0);
  });
});

// ─── CLI: Body Similarity Percentages ────────────────────────────────────────

describe("CLI: body similarity percentages appear in output", () => {
  test("stdout contains body sim percentage pattern", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/body sim: \d+%/);
  });

  test("body sim percentage is between 0 and 100", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const matches = [...stdout.matchAll(/body sim: (\d+)%/g)];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const pct = parseInt(m[1], 10);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });

  test("validated clusters have high body sim (makeDeps > 50%)", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const match = stdout.match(/makeDeps \[factory\] — .+body sim: (\d+)%/);
    expect(match).not.toBeNull();
    const pct = parseInt(match![1], 10);
    expect(pct).toBeGreaterThan(50);
  });

  test("cluster lines include validated or name-only label", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/body sim: \d+%, (validated|name-only)/);
  });
});
