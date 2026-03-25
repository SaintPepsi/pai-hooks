/**
 * paih CLI entry point tests.
 */

import { describe, it, expect } from "bun:test";
import { main } from "@hooks/cli/bin/paih";

describe("paih CLI", () => {
  it("--help exits 0 with usage on stdout", () => {
    const result = main(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stream).toBe("stdout");
    expect(result.output).toContain("paih");
    expect(result.output).toContain("Usage:");
  });

  it("--version exits 0 with version on stdout", () => {
    const result = main(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stream).toBe("stdout");
    expect(result.output).toMatch(/paih v\d+\.\d+\.\d+/);
  });

  it("no args exits 1 with usage on stderr", () => {
    const result = main([]);
    expect(result.exitCode).toBe(1);
    expect(result.stream).toBe("stderr");
    expect(result.output).toContain("Usage:");
  });

  it("unknown command exits 1 with error message", () => {
    const result = main(["frobnicate"]);
    expect(result.exitCode).toBe(1);
    expect(result.stream).toBe("stderr");
    expect(result.output).toContain("Unknown command: frobnicate");
  });

  it("unknown flag exits 1 with error", () => {
    const result = main(["install", "--bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stream).toBe("stderr");
    expect(result.output).toContain("--bogus");
  });

  it("install with no names exits 1 with error", () => {
    const result = main(["install"]);
    expect(result.exitCode).toBe(1);
    expect(result.stream).toBe("stderr");
    expect(result.output).toContain("requires at least one");
  });

  it("known stub command exits 0 with stub message", () => {
    const result = main(["status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stream).toBe("stdout");
    expect(result.output).toContain("status");
  });

  it("--help takes priority over command", () => {
    const result = main(["install", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Usage:");
  });
});
