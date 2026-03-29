import { beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { ensureDir, readFile, removeFile, writeFile } from "@hooks/core/adapters/fs";

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
  // Use process.execPath instead of bare "bun" — in CI the bun binary
  // may not be on PATH for subprocesses spawned by Bun.spawnSync
  const result = Bun.spawnSync([process.execPath, handlerPath], {
    env: { PAI_DIR: paiDir, HOME: paiDir, PATH: Bun.env.PATH },
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode ?? 1,
    stderr: result.stderr.toString(),
  };
}

function readCounts(paiDir: string): Record<string, unknown> {
  const content = readFile(join(paiDir, "MEMORY", "STATE", "counts.json"));
  if (!content.ok) return {};
  return JSON.parse(content.value) as Record<string, unknown>;
}

function setupPaiDir(): string {
  const dir = makeTempDir();

  // Skills
  writeTestFile(join(dir, "skills", "SkillA", "SKILL.md"), "---\nname: SkillA\n---\n");
  writeTestFile(join(dir, "skills", "SkillB", "SKILL.md"), "---\nname: SkillB\n---\n");
  ensureDir(join(dir, "skills", "NotASkill"));

  // MEMORY
  writeTestFile(join(dir, "MEMORY", "LEARNING", "note.md"), "");
  ensureDir(join(dir, "MEMORY", "WORK", "session-1"));
  ensureDir(join(dir, "MEMORY", "WORK", "session-2"));
  writeTestFile(join(dir, "MEMORY", "log.jsonl"), "");
  ensureDir(join(dir, "MEMORY", "RESEARCH"));
  ensureDir(join(dir, "MEMORY", "STATE"));

  // Ratings
  writeTestFile(
    join(dir, "MEMORY", "LEARNING", "SIGNALS", "ratings.jsonl"),
    '{"rating":8}\n{"rating":9}\n{"rating":7}\n',
  );

  // PAI/USER
  writeTestFile(join(dir, "PAI", "USER", "identity.md"), "");

  // Settings with hook registrations (hooks count reads from here)
  const settings = {
    existing: true,
    hooks: {
      PreToolUse: [
        {
          hooks: [
            { type: "command", command: "hook1.ts" },
            { type: "command", command: "hook2.ts" },
          ],
        },
      ],
      SessionEnd: [{ hooks: [{ type: "command", command: "hook3.ts" }] }],
    },
  };
  writeTestFile(join(dir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);

  return dir;
}

beforeEach(() => {
  testDir = setupPaiDir();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("UpdateCounts handler", () => {
  it("writes counts to MEMORY/STATE/counts.json", () => {
    const { exitCode } = runHandler(testDir);

    expect(exitCode).toBe(0);

    const counts = readCounts(testDir);
    expect(counts.skills).toBe(2);
    expect(counts.hooks).toBe(3); // 2 in PreToolUse + 1 in SessionEnd
    expect(counts.signals).toBe(1);
    expect(counts.work).toBe(2);
    expect(counts.sessions).toBe(2); // log.jsonl + ratings.jsonl
    expect(counts.ratings).toBe(3);
    expect(counts.files).toBe(1);
    expect(counts.research).toBe(0);
    expect(counts.updatedAt).toBeDefined();
  });

  it("does not have workflows in output", () => {
    runHandler(testDir);

    const counts = readCounts(testDir);
    expect(counts).not.toHaveProperty("workflows");
  });

  it("does not modify settings.json", () => {
    runHandler(testDir);

    const settingsContent = readFile(join(testDir, "settings.json"));
    expect(settingsContent.ok).toBe(true);
    if (settingsContent.ok) {
      const settings = JSON.parse(settingsContent.value) as Record<string, unknown>;
      expect(settings).not.toHaveProperty("counts");
      expect(settings.existing).toBe(true);
    }
  });

  it("logs summary to stderr", () => {
    const { stderr } = runHandler(testDir);

    expect(stderr).toContain("[UpdateCounts] Updated:");
    expect(stderr).toContain("SK:2");
    expect(stderr).toContain("HK:3");
    expect(stderr).not.toContain("WF:");
  });

  it("handles empty MEMORY directory", () => {
    const emptyDir = makeTempDir();
    writeTestFile(join(emptyDir, "settings.json"), `${JSON.stringify({ hooks: {} }, null, 2)}\n`);
    ensureDir(join(emptyDir, "MEMORY"));
    ensureDir(join(emptyDir, "MEMORY", "STATE"));
    ensureDir(join(emptyDir, "skills"));
    ensureDir(join(emptyDir, "PAI", "USER"));

    const { exitCode } = runHandler(emptyDir);

    expect(exitCode).toBe(0);

    const counts = readCounts(emptyDir);
    expect(counts.work).toBe(0);
    expect(counts.sessions).toBe(0);
    expect(counts.ratings).toBe(0);
    expect(counts.signals).toBe(0);
    expect(counts.hooks).toBe(0);
  });

  it("counts zero ratings when file is missing", () => {
    removeFile(join(testDir, "MEMORY", "LEARNING", "SIGNALS", "ratings.jsonl"));

    const { exitCode } = runHandler(testDir);

    expect(exitCode).toBe(0);

    const counts = readCounts(testDir);
    expect(counts.ratings).toBe(0);
  });
});
