/**
 * Tests for core/types/hook-outputs.ts — output factory helpers.
 */

import { describe, expect, it } from "bun:test";
import { ask, block, context, continueOk, silent } from "@hooks/core/types/hook-outputs";

describe("hook output factories", () => {
  it("continueOk returns ContinueOutput", () => {
    const output = continueOk();
    expect(output.type).toBe("continue");
    expect(output.continue).toBe(true);
  });

  it("continueOk with additionalContext", () => {
    const output = continueOk("extra info");
    expect(output.additionalContext).toBe("extra info");
  });

  it("block returns BlockOutput", () => {
    const output = block("not allowed");
    expect(output.type).toBe("block");
    expect(output.reason).toBe("not allowed");
  });

  it("ask returns AskOutput", () => {
    const output = ask("confirm?");
    expect(output.type).toBe("ask");
    expect(output.message).toBe("confirm?");
  });

  it("context returns ContextOutput", () => {
    const output = context("some content");
    expect(output.type).toBe("context");
    expect(output.content).toBe("some content");
  });

  it("silent returns SilentOutput", () => {
    const output = silent();
    expect(output.type).toBe("silent");
  });
});
