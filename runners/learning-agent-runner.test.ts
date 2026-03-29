import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureDir,
  fileExists,
  removeDir,
  removeFile,
  writeFile,
} from "@hooks/core/adapters/fs";
import { run } from "@hooks/runners/learning-agent-runner";

const TEST_DIR = join(tmpdir(), `pai-learning-runner-test-${process.pid}`);
const PROPOSALS_DIR = join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS");

beforeEach(() => {
  ensureDir(PROPOSALS_DIR);
});

afterEach(() => {
  removeDir(TEST_DIR);
});

describe("learning-agent-runner", () => {
  it("removes lock file after process exits", () => {
    writeFile(join(PROPOSALS_DIR, ".analyzing"), new Date().toISOString());

    // "true" is a command that exits 0 immediately
    run(TEST_DIR, "true");

    expect(fileExists(join(PROPOSALS_DIR, ".analyzing"))).toBe(false);
  });

  it("removes lock file even when the process fails", () => {
    writeFile(join(PROPOSALS_DIR, ".analyzing"), new Date().toISOString());

    // "false" is a command that exits 1 (failure)
    run(TEST_DIR, "false");

    expect(fileExists(join(PROPOSALS_DIR, ".analyzing"))).toBe(false);
  });
});
