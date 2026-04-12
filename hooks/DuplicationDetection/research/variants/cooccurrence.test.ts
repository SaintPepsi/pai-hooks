import { describe, expect, test } from "bun:test";

// ─── Helpers ────────────────────────────────────────────────────────────────

const SCRIPT_PATH = `${import.meta.dir}/cooccurrence.ts`;
const PAI_HOOKS_DIR = `${import.meta.dir}/../../../..`;

async function runCLI(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const id = Math.random().toString(36).slice(2);
  const stdoutPath = `/tmp/cooccurrence-test-${id}.txt`;
  const stderrPath = `/tmp/cooccurrence-test-stderr-${id}.txt`;

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

// ─── CLI: No Arguments ───────────────────────────────────────────────────────

describe("CLI: missing directory argument", () => {
  test("exits with code 1 when no args given", async () => {
    const { exitCode } = await runCLI([]);
    expect(exitCode).toBe(1);
  });

  test("stderr contains usage string when no args given", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("Usage:");
  });

  test("stderr usage mentions cooccurrence.ts", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("cooccurrence.ts");
  });

  test("stderr usage mentions --min-support flag", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("--min-support");
  });

  test("stderr usage mentions --max-tuple flag", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("--max-tuple");
  });
});

// ─── CLI: Output Header and Structure ────────────────────────────────────────

describe("CLI: output header and structure against pai-hooks", () => {
  test("exits with code 0 for valid directory", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR]);
    expect(exitCode).toBe(0);
  });

  test("stdout contains Function Co-occurrence Mining header", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Function Co-occurrence Mining");
  });

  test("stdout contains Cycle 8 annotation", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Cycle 8");
  });

  test("stdout contains scanned file and function counts", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Scanned: \d+ files, \d+ functions/);
  });

  test("stdout contains total tuples and maximal tuples counts", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Total tuples found: \d+ \| Maximal tuples: \d+/);
  });

  test("stderr reports parsed file and function count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/Parsed \d+ files/);
  });

  test("stderr reports frequent pairs count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/Found \d+ frequent pairs/);
  });

  test("stderr reports expanded tuples count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/Expanded to \d+ tuples/);
  });

  test("stderr reports maximal tuples count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/Filtered to \d+ maximal tuples/);
  });
});

// ─── CLI: Required Output Sections ───────────────────────────────────────────

describe("CLI: required output sections are present", () => {
  test("stdout contains Tuple Size Distribution section", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Tuple Size Distribution");
  });

  test("stdout contains Validated Templates section", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Validated Templates");
  });

  test("stdout contains Found N template tuple(s) line", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Found \d+ template tuple\(s\)/);
  });
});

// ─── CLI: Coincidental Section (optional but expected for pai-hooks) ──────────

describe("CLI: Coincidental Co-occurrences section (when non-templates exist)", () => {
  test("if Coincidental section present it contains non-template tuple(s) line", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const hasCoincidental = stdout.includes("Coincidental Co-occurrences");
    if (hasCoincidental) {
      expect(stdout).toMatch(/Found \d+ non-template tuple\(s\)/);
    }
  });

  test("if Coincidental section present it contains not a template marker", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const hasCoincidental = stdout.includes("Coincidental Co-occurrences");
    if (hasCoincidental) {
      expect(stdout).toContain("not a template");
    }
  });
});

// ─── CLI: {makeDeps, makeInput} Template ─────────────────────────────────────

describe("CLI: {makeDeps, makeInput} appears as a template", () => {
  test("stdout contains makeDeps in output", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("makeDeps");
  });

  test("stdout contains makeInput in output", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("makeInput");
  });

  test("{makeDeps, makeInput} tuple appears with at least 20 files", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const idx = stdout.indexOf("makeDeps");
    expect(idx).toBeGreaterThan(-1);
    const after = stdout.slice(idx, idx + 200);
    const match = after.match(/(\d+) files/);
    expect(match).not.toBeNull();
    const count = parseInt(match![1], 10);
    expect(count).toBeGreaterThanOrEqual(20);
  });

  test("{makeDeps, makeInput} tuple shows avg body sim percentage", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const idx = stdout.indexOf("makeDeps");
    expect(idx).toBeGreaterThan(-1);
    const after = stdout.slice(idx, idx + 200);
    expect(after).toMatch(/\d+% avg body sim/);
  });

  test("{makeDeps, makeInput} template body similarity is >50%", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const idx = stdout.indexOf("makeDeps");
    expect(idx).toBeGreaterThan(-1);
    const after = stdout.slice(idx, idx + 200);
    const match = after.match(/(\d+)% avg body sim/);
    expect(match).not.toBeNull();
    const pct = parseInt(match![1], 10);
    expect(pct).toBeGreaterThan(50);
  });
});

// ─── CLI: 6-tuple {blockCountPath, buildBlockLimitReview, ...} ───────────────

describe("CLI: 6-tuple obligation state machine functions appear", () => {
  test("stdout contains blockCountPath", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("blockCountPath");
  });

  test("stdout contains buildBlockLimitReview", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("buildBlockLimitReview");
  });

  test("blockCountPath tuple appears with at least 4 files", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const idx = stdout.indexOf("blockCountPath");
    expect(idx).toBeGreaterThan(-1);
    const after = stdout.slice(idx, idx + 300);
    const match = after.match(/(\d+) files/);
    expect(match).not.toBeNull();
    const count = parseInt(match![1], 10);
    expect(count).toBeGreaterThanOrEqual(4);
  });
});

// ─── CLI: Body Similarity Output Format ──────────────────────────────────────

describe("CLI: body similarity percentages in output", () => {
  test("avg body sim text appears in output", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("avg body sim");
  });

  test("body sim percentages appear in template entries", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/\d+% avg body sim/);
  });

  test("body sim percentages in templates are between 0 and 100", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const matches = [...stdout.matchAll(/(\d+)% avg body sim/g)];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const pct = parseInt(m[1], 10);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });

  test("templates section body sim values are all >50%", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    // Find the Validated Templates section, collect all body sim values within it
    const templatesIdx = stdout.indexOf("Validated Templates");
    const coincidentalIdx = stdout.indexOf("Coincidental Co-occurrences");
    const end =
      coincidentalIdx > templatesIdx && coincidentalIdx !== -1 ? coincidentalIdx : stdout.length;
    const templatesSection = stdout.slice(templatesIdx, end);
    const matches = [...templatesSection.matchAll(/(\d+)% avg body sim/g)];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const pct = parseInt(m[1], 10);
      expect(pct).toBeGreaterThan(50);
    }
  });
});

// ─── CLI: Tuple Size Distribution content ────────────────────────────────────

describe("CLI: tuple size distribution content", () => {
  test("2-tuples entry appears in distribution", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/2-tuples: \d+/);
  });

  test("size distribution shows at least one larger tuple size", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    // At minimum 2-tuples should exist; likely 3+ tuples given the known templates
    expect(stdout).toMatch(/\d+-tuples: \d+/);
  });
});

// ─── CLI: --min-support flag affects results ──────────────────────────────────

describe("CLI: --min-support flag affects results", () => {
  test("--min-support exits with code 0", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--min-support", "5"]);
    expect(exitCode).toBe(0);
  });

  test("higher --min-support produces fewer or equal maximal tuples", async () => {
    const [{ stdout: outLow }, { stdout: outHigh }] = await Promise.all([
      runCLI([PAI_HOOKS_DIR, "--min-support", "3"]),
      runCLI([PAI_HOOKS_DIR, "--min-support", "10"]),
    ]);

    const extractMaximal = (out: string): number => {
      const match = out.match(/Maximal tuples: (\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    };

    expect(extractMaximal(outLow)).toBeGreaterThanOrEqual(extractMaximal(outHigh));
  });

  test("very high --min-support (999) produces zero tuples", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR, "--min-support", "999"]);
    const match = stdout.match(/Maximal tuples: (\d+)/);
    const count = match ? parseInt(match[1], 10) : 0;
    expect(count).toBe(0);
  });

  test("--min-support 3 produces more tuples than --min-support 15", async () => {
    const [{ stdout: outLow }, { stdout: outHigh }] = await Promise.all([
      runCLI([PAI_HOOKS_DIR, "--min-support", "3"]),
      runCLI([PAI_HOOKS_DIR, "--min-support", "15"]),
    ]);

    const extractTotal = (out: string): number => {
      const match = out.match(/Total tuples found: (\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    };

    expect(extractTotal(outLow)).toBeGreaterThan(extractTotal(outHigh));
  });
});

// ─── CLI: --max-tuple flag limits tuple size ──────────────────────────────────

describe("CLI: --max-tuple flag limits tuple size", () => {
  test("--max-tuple 2 exits with code 0", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--max-tuple", "2"]);
    expect(exitCode).toBe(0);
  });

  test("--max-tuple 2 produces no tuples larger than size 2", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR, "--max-tuple", "2"]);
    // With max-tuple 2, distribution should only show 2-tuples
    expect(stdout).not.toMatch(/[3-9]-tuples: [1-9]/);
  });

  test("--max-tuple 2 produces fewer or equal total tuples than default", async () => {
    const [{ stdout: outSmall }, { stdout: outDefault }] = await Promise.all([
      runCLI([PAI_HOOKS_DIR, "--max-tuple", "2"]),
      runCLI([PAI_HOOKS_DIR]),
    ]);

    const extractTotal = (out: string): number => {
      const match = out.match(/Total tuples found: (\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    };

    // With max-tuple 2, only pairs are mined — total must be <= default total
    expect(extractTotal(outSmall)).toBeLessThanOrEqual(extractTotal(outDefault));
  });

  test("--max-tuple 3 exits with code 0", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--max-tuple", "3"]);
    expect(exitCode).toBe(0);
  });
});

// ─── CLI: Maximal Filtering (fewer maximal than total) ───────────────────────

describe("CLI: maximal filtering produces fewer tuples than total", () => {
  test("maximal tuple count is less than or equal to total tuple count", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const totalMatch = stdout.match(/Total tuples found: (\d+)/);
    const maximalMatch = stdout.match(/Maximal tuples: (\d+)/);
    expect(totalMatch).not.toBeNull();
    expect(maximalMatch).not.toBeNull();
    const total = parseInt(totalMatch![1], 10);
    const maximal = parseInt(maximalMatch![1], 10);
    expect(maximal).toBeLessThanOrEqual(total);
  });

  test("maximal tuple count is strictly less than total when large tuples exist", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const totalMatch = stdout.match(/Total tuples found: (\d+)/);
    const maximalMatch = stdout.match(/Maximal tuples: (\d+)/);
    expect(totalMatch).not.toBeNull();
    expect(maximalMatch).not.toBeNull();
    const total = parseInt(totalMatch![1], 10);
    const maximal = parseInt(maximalMatch![1], 10);
    // Given the known 6-tuple in pai-hooks that subsumes many pairs, maximal < total
    expect(maximal).toBeLessThan(total);
  });

  test("maximal count is greater than zero", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    const match = stdout.match(/Maximal tuples: (\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBeGreaterThan(0);
  });
});

// ─── CLI: Parse time in output ────────────────────────────────────────────────

describe("CLI: parse time appears in output", () => {
  test("stdout contains parse time in ms", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Parse: \d+ms/);
  });

  test("stderr contains timing information in ms", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/\d+ms/);
  });
});
