import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { runHookScript, uniqueSessionId } from "@hooks/lib/test-helpers";

const HOOK_PATH = join(import.meta.dir, "GitignoreRecommender.hook.ts");

describe("GitignoreRecommender hook shell (#182)", () => {
  it("exits 0 and returns valid JSON", async () => {
    const result = await runHookScript(HOOK_PATH, {
      session_id: uniqueSessionId("gr"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it("output contains continue: true", async () => {
    const result = await runHookScript(HOOK_PATH, {
      session_id: uniqueSessionId("gr"),
    });
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.continue).toBe(true);
  });
});
