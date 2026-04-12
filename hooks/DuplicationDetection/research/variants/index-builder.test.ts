import { beforeAll, describe, expect, test } from "bun:test";

// ─── Constants ───────────────────────────────────────────────────────────────

const SCRIPT_PATH = `${import.meta.dir}/index-builder.ts`;
const PAI_HOOKS_DIR = `${import.meta.dir}/../../../..`;

const UNIQUE_ID = Math.random().toString(36).slice(2);
const SHARED_INDEX_PATH = `/tmp/test-dup-index-${UNIQUE_ID}.json`;

const CODING_STANDARDS_FILE = `${PAI_HOOKS_DIR}/hooks/CodingStandards/CodingStandardsEnforcer/CodingStandardsEnforcer.contract.ts`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function runCLI(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const id = Math.random().toString(36).slice(2);
  const stdoutPath = `/tmp/index-builder-test-${id}-stdout.txt`;
  const stderrPath = `/tmp/index-builder-test-${id}-stderr.txt`;

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

// ─── Build index once for reuse ──────────────────────────────────────────────

beforeAll(async () => {
  const { exitCode } = await runCLI(["build", PAI_HOOKS_DIR, "--output", SHARED_INDEX_PATH]);
  if (exitCode !== 0) {
    throw new Error(`beforeAll: index build failed with exit code ${exitCode}`);
  }
});

// ─── build command: missing args ─────────────────────────────────────────────

describe("build command: missing args", () => {
  test("no args exits with code 1", async () => {
    const { exitCode } = await runCLI([]);
    expect(exitCode).toBe(1);
  });

  test("no args writes usage to stderr", async () => {
    const { stderr } = await runCLI([]);
    expect(stderr).toContain("Usage:");
  });
});

// ─── build command: success ───────────────────────────────────────────────────

describe("build command: success", () => {
  test("exits 0 for pai-hooks with --output", async () => {
    const outPath = `/tmp/test-dup-index-${Math.random().toString(36).slice(2)}.json`;
    const { exitCode } = await runCLI(["build", PAI_HOOKS_DIR, "--output", outPath]);
    expect(exitCode).toBe(0);
  });

  test("creates the output file", async () => {
    const file = Bun.file(SHARED_INDEX_PATH);
    expect(await file.exists()).toBe(true);
  });

  test("output file is valid JSON", async () => {
    const text = await Bun.file(SHARED_INDEX_PATH).text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  test("index has version field equal to 1", async () => {
    const index = JSON.parse(await Bun.file(SHARED_INDEX_PATH).text());
    expect(index.version).toBe(1);
  });

  test("index has root field", async () => {
    const index = JSON.parse(await Bun.file(SHARED_INDEX_PATH).text());
    expect(typeof index.root).toBe("string");
    expect(index.root.length).toBeGreaterThan(0);
  });

  test("index has builtAt field", async () => {
    const index = JSON.parse(await Bun.file(SHARED_INDEX_PATH).text());
    expect(typeof index.builtAt).toBe("string");
    expect(new Date(index.builtAt).getTime()).toBeGreaterThan(0);
  });

  test("index has fileCount greater than 0", async () => {
    const index = JSON.parse(await Bun.file(SHARED_INDEX_PATH).text());
    expect(index.fileCount).toBeGreaterThan(0);
  });

  test("index has functionCount greater than 0", async () => {
    const index = JSON.parse(await Bun.file(SHARED_INDEX_PATH).text());
    expect(index.functionCount).toBeGreaterThan(0);
  });

  test("index has entries array", async () => {
    const index = JSON.parse(await Bun.file(SHARED_INDEX_PATH).text());
    expect(Array.isArray(index.entries)).toBe(true);
    expect(index.entries.length).toBeGreaterThan(0);
  });

  test("entries have f, n, l, h, p, r, fp, s fields", async () => {
    const index = JSON.parse(await Bun.file(SHARED_INDEX_PATH).text());
    const entry = index.entries[0];
    expect(typeof entry.f).toBe("string");
    expect(typeof entry.n).toBe("string");
    expect(typeof entry.l).toBe("number");
    expect(typeof entry.h).toBe("string");
    expect(typeof entry.p).toBe("string");
    expect(typeof entry.r).toBe("string");
    expect(typeof entry.fp).toBe("string");
    expect(typeof entry.s).toBe("number");
  });

  test("hashGroups is an array of [key, indices] pairs", async () => {
    const index = JSON.parse(await Bun.file(SHARED_INDEX_PATH).text());
    expect(Array.isArray(index.hashGroups)).toBe(true);
    if (index.hashGroups.length > 0) {
      const [key, idxs] = index.hashGroups[0];
      expect(typeof key).toBe("string");
      expect(Array.isArray(idxs)).toBe(true);
    }
  });

  test("nameGroups is an array of [key, indices] pairs", async () => {
    const index = JSON.parse(await Bun.file(SHARED_INDEX_PATH).text());
    expect(Array.isArray(index.nameGroups)).toBe(true);
    if (index.nameGroups.length > 0) {
      const [key, idxs] = index.nameGroups[0];
      expect(typeof key).toBe("string");
      expect(Array.isArray(idxs)).toBe(true);
    }
  });

  test("sigGroups is an array of [key, indices] pairs", async () => {
    const index = JSON.parse(await Bun.file(SHARED_INDEX_PATH).text());
    expect(Array.isArray(index.sigGroups)).toBe(true);
    if (index.sigGroups.length > 0) {
      const [key, idxs] = index.sigGroups[0];
      expect(typeof key).toBe("string");
      expect(Array.isArray(idxs)).toBe(true);
    }
  });

  test("index file is between 100KB and 300KB", async () => {
    const text = await Bun.file(SHARED_INDEX_PATH).text();
    const sizeKb = text.length / 1024;
    expect(sizeKb).toBeGreaterThan(100);
    expect(sizeKb).toBeLessThan(300);
  });

  test("stderr reports function count", async () => {
    const outPath = `/tmp/test-dup-index-${Math.random().toString(36).slice(2)}.json`;
    const { stderr } = await runCLI(["build", PAI_HOOKS_DIR, "--output", outPath]);
    expect(stderr).toMatch(/\d+ functions/);
  });

  test("stderr reports file count", async () => {
    const outPath = `/tmp/test-dup-index-${Math.random().toString(36).slice(2)}.json`;
    const { stderr } = await runCLI(["build", PAI_HOOKS_DIR, "--output", outPath]);
    expect(stderr).toMatch(/\d+ files/);
  });
});

// ─── check command: missing args ──────────────────────────────────────────────

describe("check command: missing file", () => {
  test("check with no file exits 1", async () => {
    const { exitCode } = await runCLI(["check"]);
    expect(exitCode).toBe(1);
  });
});

// ─── check command: missing index ────────────────────────────────────────────

describe("check command: missing index", () => {
  test("exits 1 when index file does not exist", async () => {
    const { exitCode } = await runCLI([
      "check",
      CODING_STANDARDS_FILE,
      "--index",
      "/tmp/nonexistent-index-file.json",
    ]);
    expect(exitCode).toBe(1);
  });

  test("stderr contains 'not found' when index is missing", async () => {
    const { stderr } = await runCLI([
      "check",
      CODING_STANDARDS_FILE,
      "--index",
      "/tmp/nonexistent-index-file.json",
    ]);
    expect(stderr.toLowerCase()).toContain("not found");
  });
});

// ─── check command: duplication detection ────────────────────────────────────

describe("check command: duplication detection", () => {
  test("exits 0 when checking CodingStandardsEnforcer contract", async () => {
    const { exitCode } = await runCLI([
      "check",
      CODING_STANDARDS_FILE,
      "--index",
      SHARED_INDEX_PATH,
    ]);
    expect(exitCode).toBe(0);
  });

  test("stdout contains getWriteContent as a duplication signal", async () => {
    const { stdout } = await runCLI(["check", CODING_STANDARDS_FILE, "--index", SHARED_INDEX_PATH]);
    expect(stdout).toContain("getWriteContent");
  });

  test("stdout contains signal indicator bars (● and ○)", async () => {
    const { stdout } = await runCLI(["check", CODING_STANDARDS_FILE, "--index", SHARED_INDEX_PATH]);
    expect(stdout).toMatch(/[●○]/);
  });

  test("stdout contains percentage scores", async () => {
    const { stdout } = await runCLI(["check", CODING_STANDARDS_FILE, "--index", SHARED_INDEX_PATH]);
    expect(stdout).toMatch(/\d+%/);
  });

  test("stderr reports load time in ms", async () => {
    const { stderr } = await runCLI(["check", CODING_STANDARDS_FILE, "--index", SHARED_INDEX_PATH]);
    expect(stderr).toMatch(/Loaded index in \d+ms/);
  });

  test("stderr reports check time in ms", async () => {
    const { stderr } = await runCLI(["check", CODING_STANDARDS_FILE, "--index", SHARED_INDEX_PATH]);
    expect(stderr).toMatch(/checked in [\d.]+ms/);
  });

  test("check time is under 50ms", async () => {
    const { stderr } = await runCLI(["check", CODING_STANDARDS_FILE, "--index", SHARED_INDEX_PATH]);
    const match = stderr.match(/checked in ([\d.]+)ms/);
    expect(match).not.toBeNull();
    const checkTimeMs = parseFloat(match![1]);
    expect(checkTimeMs).toBeLessThan(50);
  });
});

// ─── stats command ────────────────────────────────────────────────────────────

describe("stats command", () => {
  test("exits 0 with valid index", async () => {
    const { exitCode } = await runCLI(["stats", "--index", SHARED_INDEX_PATH]);
    expect(exitCode).toBe(0);
  });

  test("output shows file count", async () => {
    const { stdout } = await runCLI(["stats", "--index", SHARED_INDEX_PATH]);
    expect(stdout).toMatch(/Files:\s+\d+/);
  });

  test("output shows function count", async () => {
    const { stdout } = await runCLI(["stats", "--index", SHARED_INDEX_PATH]);
    expect(stdout).toMatch(/Functions:\s+\d+/);
  });

  test("output shows hash group count", async () => {
    const { stdout } = await runCLI(["stats", "--index", SHARED_INDEX_PATH]);
    expect(stdout).toMatch(/Hash groups/);
  });

  test("output shows name group count", async () => {
    const { stdout } = await runCLI(["stats", "--index", SHARED_INDEX_PATH]);
    expect(stdout).toMatch(/Name groups/);
  });

  test("output shows signature group count", async () => {
    const { stdout } = await runCLI(["stats", "--index", SHARED_INDEX_PATH]);
    expect(stdout).toMatch(/Signature groups/);
  });

  test("exits 1 when index is missing", async () => {
    const { exitCode } = await runCLI(["stats", "--index", "/tmp/nonexistent-stats-index.json"]);
    expect(exitCode).toBe(1);
  });
});
