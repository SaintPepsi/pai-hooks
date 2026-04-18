import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { fileExists } from "@hooks/core/adapters/fs";

const STUB_DIR = import.meta.dir;

describe("mode-analytics stubs", () => {
  it("CollectModeData.ts exists", () => {
    expect(fileExists(join(STUB_DIR, "CollectModeData.ts"))).toBe(true);
  });

  it("GenerateDashboard.ts exists", () => {
    expect(fileExists(join(STUB_DIR, "GenerateDashboard.ts"))).toBe(true);
  });

  it("CollectModeData.ts delegates to .mjs", async () => {
    const content = await Bun.file(join(STUB_DIR, "CollectModeData.ts")).text();
    expect(content).toContain("CollectModeData.mjs");
    expect(content).toContain("Bun.spawnSync");
  });

  it("GenerateDashboard.ts delegates to .mjs", async () => {
    const content = await Bun.file(join(STUB_DIR, "GenerateDashboard.ts")).text();
    expect(content).toContain("GenerateDashboard.mjs");
    expect(content).toContain("Bun.spawnSync");
  });
});
