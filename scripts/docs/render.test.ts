import { afterAll, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureDir,
  fileExists,
  readFile,
  removeDir,
  writeFile,
} from "@hooks/core/adapters/fs";
import { execSyncSafe } from "@hooks/core/adapters/process";

const TMP = join(tmpdir(), `pai-render-test-${process.pid}`);
const HOOKS = join(TMP, "hooks");
const OUT = join(TMP, "out");

function setupFixture(opts: { withIdea: boolean }): void {
  const hookDir = join(TMP, "hooks", "TestGroup", "TestHook");
  ensureDir(hookDir);

  writeFile(
    join(TMP, "hooks", "TestGroup", "group.json"),
    JSON.stringify({
      name: "TestGroup",
      description: "A group",
      hooks: ["TestHook"],
    }),
  );
  writeFile(
    join(hookDir, "hook.json"),
    JSON.stringify({
      name: "TestHook",
      group: "TestGroup",
      event: "PostToolUse",
      description: "A hook",
    }),
  );
  writeFile(join(hookDir, "doc.md"), "## Overview\n\nTest hook overview.");

  if (opts.withIdea) {
    writeFile(
      join(hookDir, "IDEA.md"),
      "# Test Hook\n\n> One-line pitch.\n\n## Problem\n\nA problem.\n\n## Solution\n\nA solution.",
    );
  }
}

describe("render.ts integration", () => {
  afterAll(() => {
    if (fileExists(TMP)) removeDir(TMP);
  });

  it("includes copy-idea button when IDEA.md exists", () => {
    if (fileExists(TMP)) removeDir(TMP);
    setupFixture({ withIdea: true });

    const renderScript = join(import.meta.dir, "render.ts");
    const result = execSyncSafe(
      `bun run ${renderScript} --hooks-dir ${HOOKS} --out ${OUT}`,
      {
        cwd: TMP,
      },
    );
    expect(result.ok).toBe(true);

    const htmlResult = readFile(
      join(OUT, "groups", "TestGroup", "TestHook.html"),
    );
    expect(htmlResult.ok).toBe(true);
    if (!htmlResult.ok) throw new Error(htmlResult.error.message);

    expect(htmlResult.value).toContain('onclick="copyIdea()"');
    expect(htmlResult.value).toContain('id="ideaContent"');
    expect(htmlResult.value).toContain("# Test Hook");
  });

  it("omits copy-idea button when no IDEA.md", () => {
    if (fileExists(TMP)) removeDir(TMP);
    setupFixture({ withIdea: false });

    const renderScript = join(import.meta.dir, "render.ts");
    const result = execSyncSafe(
      `bun run ${renderScript} --hooks-dir ${HOOKS} --out ${OUT}`,
      {
        cwd: TMP,
      },
    );
    expect(result.ok).toBe(true);

    const htmlResult = readFile(
      join(OUT, "groups", "TestGroup", "TestHook.html"),
    );
    expect(htmlResult.ok).toBe(true);
    if (!htmlResult.ok) throw new Error(htmlResult.error.message);

    expect(htmlResult.value).not.toContain('onclick="copyIdea()"');
    expect(htmlResult.value).not.toContain('id="ideaContent"');
  });
});
