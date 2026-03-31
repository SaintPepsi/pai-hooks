import { describe, expect, test } from "bun:test";

// ─── Helpers ────────────────────────────────────────────────────────────────

const SCRIPT_PATH = import.meta.dir + "/composite-ranker.ts";
const PAI_HOOKS_DIR = "/Users/ian.hogers/.claude/pai-hooks";

async function runCLI(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const id = Math.random().toString(36).slice(2);
  const stdoutPath = `/tmp/composite-ranker-test-${id}.txt`;
  const stderrPath = `/tmp/composite-ranker-test-stderr-${id}.txt`;

  const proc = Bun.spawn(["/Users/ian.hogers/.bun/bin/bun", SCRIPT_PATH, ...args], {
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

function _extractOpportunityCount(output: string): number {
  const m = output.match(/Top Refactoring Opportunities \((\d+) total\)/);
  return m ? parseInt(m[1], 10) : 0;
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

  test("stderr usage mentions composite-ranker.ts", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("composite-ranker.ts");
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
    expect(stdout).toContain("Composite Multi-Signal DRY Ranker");
  });

  test("stdout contains Signal Dimension Distribution section", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Signal Dimension Distribution");
  });

  test("stdout contains Top Refactoring Opportunities section", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Top Refactoring Opportunities");
  });

  test("stdout contains scanned file and function counts", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Scanned: \d+ files, \d+ functions/);
  });
});

// ─── CLI: dimension distribution content ────────────────────────────────────

describe("CLI: dimension distribution content", () => {
  test("dimension distribution shows count for 1 dimension", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/1 dimensions:\s+\d+/);
  });

  test("dimension distribution shows count for 2 dimensions", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/2 dimensions:\s+\d+/);
  });

  test("dimension distribution shows count for 3 dimensions", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/3 dimensions:\s+\d+/);
  });

  test("dimension distribution shows count for 4 dimensions", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/4 dimensions:\s+\d+/);
  });

  test("functions with detection signals line appears", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/Functions with detection signals: \d+ \/ \d+/);
  });
});

// ─── CLI: top refactoring opportunities content ──────────────────────────────

describe("CLI: top refactoring opportunities content", () => {
  test("rank numbers appear in output (#1, #2)", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/#1\s/);
    expect(stdout).toMatch(/#2\s/);
  });

  test("runHook appears as a top opportunity", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("runHook");
  });

  test("runHook entry shows 4 dimensions (●●●●)", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/runHook\s*\[●●●●\]/);
  });

  test("makeSourceRepo appears as a top opportunity", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("makeSourceRepo");
  });

  test("Est. savings appears in opportunity entries", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("Est. savings");
  });

  test("opportunity entries show instances across files", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/\d+ instances across \d+ files/);
  });
});

// ─── CLI: signal types in output ─────────────────────────────────────────────

describe("CLI: signal types appear in output", () => {
  test("hash signal type appears", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("hash");
  });

  test("name signal type appears", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("name");
  });

  test("signature signal type appears", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("signature");
  });

  test("body signal type appears", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toContain("body");
  });

  test("percentage scores appear per signal (e.g. hash:100%)", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR]);
    expect(stdout).toMatch(/\w+:\d+%/);
  });
});

// ─── CLI: --top flag behavior ─────────────────────────────────────────────────

describe("CLI: --top flag affects output", () => {
  test("--top 5 exits with code 0", async () => {
    const { exitCode } = await runCLI([PAI_HOOKS_DIR, "--top", "5"]);
    expect(exitCode).toBe(0);
  });

  test("--top 5 shows fewer rank entries than --top 30", async () => {
    const [{ stdout: outTop5 }, { stdout: outTop30 }] = await Promise.all([
      runCLI([PAI_HOOKS_DIR, "--top", "5"]),
      runCLI([PAI_HOOKS_DIR, "--top", "30"]),
    ]);

    const rankMatches5 = (outTop5.match(/#\d+\s/g) ?? []).length;
    const rankMatches30 = (outTop30.match(/#\d+\s/g) ?? []).length;

    expect(rankMatches5).toBeGreaterThan(0);
    expect(rankMatches30).toBeGreaterThanOrEqual(rankMatches5);
  });

  test("--top 1 shows #1 but not #6 in output", async () => {
    const { stdout } = await runCLI([PAI_HOOKS_DIR, "--top", "1"]);
    expect(stdout).toMatch(/#1\s/);
    expect(stdout).not.toMatch(/#6\s/);
  });
});

// ─── CLI: stderr parse stats ──────────────────────────────────────────────────

describe("CLI: stderr parse stats", () => {
  test("stderr reports parsed file count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/Parsed \d+ files/);
  });

  test("stderr reports function count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/\d+ functions/);
  });

  test("stderr reports scored function count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/Scored \d+ functions/);
  });

  test("stderr reports opportunities found count", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/found \d+ opportunities/);
  });

  test("stderr reports parse time in ms", async () => {
    const { stderr } = await runCLI([PAI_HOOKS_DIR]);
    expect(stderr).toMatch(/\d+ms/);
  });
});
