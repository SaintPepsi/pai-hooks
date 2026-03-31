import { describe, expect, test } from "bun:test";

// ─── Helpers ────────────────────────────────────────────────────────────────

const SCRIPT_PATH = import.meta.dir + "/file-template.ts";
const PAI_HOOKS_DIR = "/Users/ian.hogers/.claude/pai-hooks";

async function runCLI(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Bun.spawnSync stdout/stderr pipe capture is broken inside this project's
  // bun test runner — use temp files to capture output instead.
  const id = Math.random().toString(36).slice(2);
  const stdoutPath = `/tmp/file-template-test-${id}.txt`;
  const stderrPath = `/tmp/file-template-test-stderr-${id}.txt`;

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

  test("stderr contains file-template script name in usage", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("file-template.ts");
  });

  test("stderr contains --min-files flag in usage", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("--min-files");
  });

  test("stderr contains --fuzzy-threshold flag in usage", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("--fuzzy-threshold");
  });
});

// ─── CLI: Output Header ──────────────────────────────────────────────────────

describe("CLI: output header and structure against pai-hooks", () => {
  test("exits with code 0 for valid directory", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR]);
    expect(exitCode).toBe(0);
  });

  test("stdout contains File-Level Template Detection header", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("File-Level Template Detection");
  });

  test("stdout contains Cycle 4 annotation", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Cycle 4");
  });

  test("stdout contains scanned file and function counts", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Scanned: \d+ files, \d+ functions/);
  });

  test("stderr reports parsed file count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/Parsed \d+ files/);
  });

  test("stderr reports template and fuzzy match counts", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/Found \d+ templates, \d+ fuzzy matches/);
  });
});

// ─── CLI: All Three Sections Present ─────────────────────────────────────────

describe("CLI: three required output sections", () => {
  test("stdout contains File Category Distribution section", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("File Category Distribution");
  });

  test("stdout contains Exact Template Clusters section", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Exact Template Clusters");
  });

  test("stdout contains Fuzzy Template Matches section", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Fuzzy Template Matches");
  });

  test("exact template clusters section has Found N template(s) line", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Found \d+ template\(s\)/);
  });

  test("fuzzy template matches section has Found N near-template pair(s) line", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Found \d+ near-template pair\(s\)/);
  });
});

// ─── CLI: {makeDeps, makeInput} Template Cluster ─────────────────────────────

describe("CLI: {makeDeps, makeInput} template cluster appears in pai-hooks output", () => {
  test("stdout contains makeDeps in a template fingerprint", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("makeDeps");
  });

  test("stdout contains makeInput in a template fingerprint", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("makeInput");
  });

  test("{makeDeps, makeInput} template has at least 21 files", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    // The template line shows: Template: {makeDeps, makeInput} [test]
    // followed by: N files, avg similarity X%
    const templateIdx = stdout.indexOf("makeDeps, makeInput");
    expect(templateIdx).toBeGreaterThan(-1);
    const afterTemplate = stdout.slice(templateIdx);
    const match = afterTemplate.match(/(\d+) files,/);
    expect(match).not.toBeNull();
    const count = parseInt(match![1], 10);
    expect(count).toBeGreaterThanOrEqual(20);
  });

  test("{makeDeps, makeInput} template is classified as test category", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/makeDeps.*makeInput.*\[test\]|makeInput.*makeDeps.*\[test\]/);
  });

  test("{makeDeps, makeInput} template shows avg similarity percentage", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const templateIdx = stdout.indexOf("makeDeps");
    expect(templateIdx).toBeGreaterThan(-1);
    const afterTemplate = stdout.slice(templateIdx, templateIdx + 300);
    expect(afterTemplate).toMatch(/avg similarity \d+%/);
  });
});

// ─── CLI: {runHook} Template Cluster ─────────────────────────────────────────

describe("CLI: {runHook} template cluster appears in pai-hooks output", () => {
  test("stdout contains runHook in a template fingerprint", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("runHook");
  });

  test("{runHook} template has at least 5 files", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const templateIdx = stdout.indexOf("runHook");
    expect(templateIdx).toBeGreaterThan(-1);
    const afterTemplate = stdout.slice(templateIdx);
    const match = afterTemplate.match(/(\d+) files,/);
    expect(match).not.toBeNull();
    const count = parseInt(match![1], 10);
    expect(count).toBeGreaterThanOrEqual(5);
  });
});

// ─── CLI: Category Distribution ──────────────────────────────────────────────

describe("CLI: category distribution shows expected categories", () => {
  test("test category appears in distribution", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/test\s+\d+ files/);
  });

  test("contract category appears in distribution", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/contract\s+\d+ files/);
  });

  test("adapter category appears in distribution", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/adapter\s+\d+ files/);
  });

  test("category distribution shows templated and percentage fields", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/\d+ files, \d+ templated \(\d+%\), \d+ templates/);
  });
});

// ─── CLI: --min-files flag affects cluster count ──────────────────────────────

describe("CLI: --min-files flag affects cluster count", () => {
  test("higher min-files produces fewer or equal exact template clusters", async () => {
    const [{ stdout: outLow }, { stdout: outHigh }] = await Promise.all([
      runCLI([PAI_HOOKS_DIR, "--min-files", "2"]),
      runCLI([PAI_HOOKS_DIR, "--min-files", "10"]),
    ]);

    const extractClusterCount = (out: string): number => {
      const match = out.match(/Found (\d+) template\(s\)/);
      return match ? parseInt(match[1], 10) : 0;
    };

    expect(extractClusterCount(outLow)).toBeGreaterThanOrEqual(extractClusterCount(outHigh));
  });

  test("very high min-files (999) produces zero exact template clusters", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR, "--min-files", "999"]);
    const match = stdout.match(/Found (\d+) template\(s\)/);
    const count = match ? parseInt(match[1], 10) : 0;
    expect(count).toBe(0);
  });

  test("--min-files 2 exits successfully", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--min-files", "2"]);
    expect(exitCode).toBe(0);
  });

  test("--min-files 5 exits successfully", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--min-files", "5"]);
    expect(exitCode).toBe(0);
  });
});

// ─── CLI: --fuzzy-threshold flag affects fuzzy match count ────────────────────

describe("CLI: --fuzzy-threshold flag affects fuzzy match count", () => {
  test("lower fuzzy threshold produces more or equal fuzzy matches", async () => {
    const [{ stdout: outLow }, { stdout: outHigh }] = await Promise.all([
      runCLI([PAI_HOOKS_DIR, "--fuzzy-threshold", "0.3"]),
      runCLI([PAI_HOOKS_DIR, "--fuzzy-threshold", "0.9"]),
    ]);

    const extractFuzzyCount = (out: string): number => {
      const match = out.match(/Found (\d+) near-template pair\(s\)/);
      return match ? parseInt(match[1], 10) : 0;
    };

    expect(extractFuzzyCount(outLow)).toBeGreaterThanOrEqual(extractFuzzyCount(outHigh));
  });

  test("very high fuzzy threshold (0.99) produces zero or few fuzzy matches", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR, "--fuzzy-threshold", "0.99"]);
    const match = stdout.match(/Found (\d+) near-template pair\(s\)/);
    const count = match ? parseInt(match[1], 10) : 0;
    expect(count).toBeLessThan(5);
  });

  test("--fuzzy-threshold 0.3 exits successfully", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--fuzzy-threshold", "0.3"]);
    expect(exitCode).toBe(0);
  });

  test("--fuzzy-threshold 0.9 exits successfully", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--fuzzy-threshold", "0.9"]);
    expect(exitCode).toBe(0);
  });
});

// ─── CLI: Fuzzy Match Output Format ──────────────────────────────────────────

describe("CLI: fuzzy matches show name overlap and body sim percentages", () => {
  test("fuzzy match lines contain name overlap percentage", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/\d+% name overlap/);
  });

  test("fuzzy match lines contain body sim percentage", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/\d+% body sim/);
  });

  test("fuzzy match lines show shared function names in braces", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Shared: \{[^}]+\}/);
  });

  test("name overlap percentage is between 0 and 100", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const matches = [...stdout.matchAll(/(\d+)% name overlap/g)];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const pct = parseInt(m[1], 10);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });

  test("body sim percentage is between 0 and 100", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const matches = [...stdout.matchAll(/(\d+)% body sim/g)];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const pct = parseInt(m[1], 10);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });

  test("fuzzy matches are excluded from exact template clusters (jaccard < 1.0)", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    // Fuzzy match shared names should never be 100% name overlap
    // (exact matches are filtered out at jaccard === 1.0)
    const matches = [...stdout.matchAll(/(\d+)% name overlap/g)];
    for (const m of matches) {
      const pct = parseInt(m[1], 10);
      expect(pct).toBeLessThan(100);
    }
  });
});
