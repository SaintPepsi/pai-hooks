import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "PreCompactStatePersist.hook.ts");

describe("PreCompactStatePersist hook shell", () => {
  it("hook shim file exists", async () => {
    const file = Bun.file(HOOK_PATH);
    expect(await file.exists()).toBe(true);
  });

  it("shim contains correct contract import", async () => {
    const file = Bun.file(HOOK_PATH);
    const content = await file.text();
    expect(content).toContain("PreCompactStatePersist");
    expect(content).toContain("runHook");
  });
});
