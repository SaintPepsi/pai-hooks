import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFile, ensureDir, removeFile, readFile } from "@hooks/core/adapters/fs";
import { join } from "path";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let testDir: string;

function makeTempDir(): string {
  const result = Bun.spawnSync(["mktemp", "-d"]);
  return result.stdout.toString().trim();
}

function writeTestFile(path: string, content = ""): void {
  const dir = path.substring(0, path.lastIndexOf("/"));
  ensureDir(dir);
  writeFile(path, content);
}

function runHandler(paiDir: string): { exitCode: number; stderr: string } {
  const handlerPath = join(__dirname, "UpdateCounts.ts");
  const result = Bun.spawnSync(["bun", handlerPath], {
    env: { PAI_DIR: paiDir, HOME: paiDir, PATH: Bun.env.PATH },
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode ?? 1,
    stderr: result.stderr.toString(),
  };
}

function readSettings(settingsPath: string): Record<string, unknown> {
  const content = readFile(settingsPath);
  if (!content.ok) return {};
  return JSON.parse(content.value) as Record<string, unknown>;
}

function setupPaiDir(): string {
  const dir = makeTempDir();

  // Skills
  writeTestFile(join(dir, "skills", "SkillA", "SKILL.md"), "---\nname: SkillA\n---\n");
  writeTestFile(join(dir, "skills", "SkillB", "SKILL.md"), "---\nname: SkillB\n---\n");
  ensureDir(join(dir, "skills", "NotASkill"));

  // Hooks
  writeTestFile(join(dir, "pai-hooks", "hooks", "one.ts"), "");
  writeTestFile(join(dir, "pai-hooks", "hooks", "two.ts"), "");
  writeTestFile(join(dir, "pai-hooks", "hooks", "readme.md"), "");

  // Workflows
  writeTestFile(join(dir, "skills", "SkillA", "Workflows", "wf1.md"), "");
  writeTestFile(join(dir, "skills", "SkillA", "Workflows", "wf2.md"), "");

  // MEMORY
  writeTestFile(join(dir, "MEMORY", "LEARNING", "note.md"), "");
  ensureDir(join(dir, "MEMORY", "WORK", "session-1"));
  ensureDir(join(dir, "MEMORY", "WORK", "session-2"));
  writeTestFile(join(dir, "MEMORY", "log.jsonl"), "");
  ensureDir(join(dir, "MEMORY", "RESEARCH"));

  // Ratings
  writeTestFile(
    join(dir, "MEMORY", "LEARNING", "SIGNALS", "ratings.jsonl"),
    '{"rating":8}\n{"rating":9}\n{"rating":7}\n',
  );

  // PAI/USER
  writeTestFile(join(dir, "PAI", "USER", "identity.md"), "");

  // Settings
  writeTestFile(join(dir, "settings.json"), JSON.stringify({ existing: true }, null, 2) + "\n");

  return dir;
}

beforeEach(() => {
  testDir = setupPaiDir();
});

// No cleanup needed — mktemp dirs in /tmp are cleaned by macOS on reboot

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("UpdateCounts handler", () => {
  it("writes counts to settings.json", () => {
    const { exitCode } = runHandler(testDir);

    expect(exitCode).toBe(0);

    const settings = readSettings(join(testDir, "settings.json"));
    const counts = settings.counts as Record<string, unknown>;
    expect(counts).toBeDefined();
    expect(counts.skills).toBe(2);
    expect(counts.hooks).toBe(2);
    expect(counts.workflows).toBe(2);
    expect(counts.signals).toBe(1);
    expect(counts.work).toBe(2);
    expect(counts.sessions).toBe(2); // log.jsonl + ratings.jsonl
    expect(counts.ratings).toBe(3);
    expect(counts.files).toBe(1);
    expect(counts.research).toBe(0);
    expect(counts.updatedAt).toBeDefined();
  });

  it("preserves existing settings keys", () => {
    runHandler(testDir);

    const settings = readSettings(join(testDir, "settings.json"));
    expect(settings.existing).toBe(true);
    expect(settings.counts).toBeDefined();
  });

  it("logs summary to stderr", () => {
    const { stderr } = runHandler(testDir);

    expect(stderr).toContain("[UpdateCounts] Updated:");
    expect(stderr).toContain("SK:2");
    expect(stderr).toContain("HK:2");
    expect(stderr).toContain("WF:2");
  });

  it("reports error when settings.json is missing", () => {
    removeFile(join(testDir, "settings.json"));

    const { stderr } = runHandler(testDir);

    expect(stderr).toContain("Failed to read settings");
  });

  it("handles empty MEMORY directory", () => {
    // Create a fresh test dir with no MEMORY contents
    const emptyDir = makeTempDir();
    writeTestFile(join(emptyDir, "settings.json"), JSON.stringify({}, null, 2) + "\n");
    ensureDir(join(emptyDir, "MEMORY"));
    ensureDir(join(emptyDir, "skills"));
    ensureDir(join(emptyDir, "pai-hooks", "hooks"));
    ensureDir(join(emptyDir, "PAI", "USER"));

    const { exitCode } = runHandler(emptyDir);

    expect(exitCode).toBe(0);

    const settings = readSettings(join(emptyDir, "settings.json"));
    const counts = settings.counts as Record<string, unknown>;
    expect(counts.work).toBe(0);
    expect(counts.sessions).toBe(0);
    expect(counts.ratings).toBe(0);
    expect(counts.signals).toBe(0);
  });

  it("counts zero ratings when file is missing", () => {
    removeFile(join(testDir, "MEMORY", "LEARNING", "SIGNALS", "ratings.jsonl"));

    const { exitCode } = runHandler(testDir);

    expect(exitCode).toBe(0);

    const settings = readSettings(join(testDir, "settings.json"));
    const counts = settings.counts as Record<string, unknown>;
    expect(counts.ratings).toBe(0);
  });
});
