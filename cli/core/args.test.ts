/**
 * CLI args parser tests.
 */

import { describe, it, expect } from "bun:test";
import { parseArgs } from "@hooks/cli/core/args";
import { PaihErrorCode } from "@hooks/cli/core/error";

describe("parseArgs()", () => {
  it("parses a command with no flags", () => {
    const result = parseArgs(["install"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.command).toBe("install");
      expect(result.value.names).toEqual([]);
      expect(result.value.flags).toEqual({});
    }
  });

  it("parses multi-name args", () => {
    const result = parseArgs(["install", "HookA", "HookB", "HookC"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.command).toBe("install");
      expect(result.value.names).toEqual(["HookA", "HookB", "HookC"]);
    }
  });

  it("parses boolean flags", () => {
    const result = parseArgs(["install", "--force", "--dry-run", "--json"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.flags.force).toBe(true);
      expect(result.value.flags.dryRun).toBe(true);
      expect(result.value.flags.json).toBe(true);
    }
  });

  it("parses value flags", () => {
    const result = parseArgs(["install", "--to", "/target", "--from", "/source"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.flags.to).toBe("/target");
      expect(result.value.flags.from).toBe("/source");
    }
  });

  it("parses --help flag", () => {
    const result = parseArgs(["--help"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.flags.help).toBe(true);
      expect(result.value.command).toBe("");
    }
  });

  it("parses --version flag", () => {
    const result = parseArgs(["--version"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.flags.version).toBe(true);
    }
  });

  it("returns Err for unknown flags", () => {
    const result = parseArgs(["install", "--unknown-flag"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.InvalidArgs);
      expect(result.error.message).toContain("--unknown-flag");
    }
  });

  it("returns Err when value flag has no value", () => {
    const result = parseArgs(["install", "--to"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.InvalidArgs);
      expect(result.error.message).toContain("--to");
    }
  });

  it("returns Err when value flag is followed by another flag", () => {
    const result = parseArgs(["install", "--to", "--force"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.InvalidArgs);
    }
  });

  it("handles empty argv", () => {
    const result = parseArgs([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.command).toBe("");
      expect(result.value.names).toEqual([]);
    }
  });

  it("handles --in value flag", () => {
    const result = parseArgs(["list", "--in", "/workspace"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.flags.in).toBe("/workspace");
    }
  });
});
