/**
 * pipe() tests — success chain, early-exit on first error, error passthrough.
 */

import { describe, it, expect } from "bun:test";
import { pipe } from "@hooks/cli/core/pipe";
import { ok, err } from "@hooks/cli/core/result";
import type { Result } from "@hooks/cli/core/result";

describe("pipe()", () => {
  it("returns initial value when no functions provided", () => {
    const result = pipe(ok(42));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it("threads value through a chain of successful functions", () => {
    const result = pipe(
      ok(1),
      (n: number): Result<number, string> => ok(n + 10),
      (n: number): Result<number, string> => ok(n * 2),
      (n: number): Result<number, string> => ok(n + 3),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(25); // ((1 + 10) * 2) + 3
  });

  it("short-circuits on first error", () => {
    let thirdCalled = false;

    const result = pipe(
      ok(1),
      (n: number): Result<number, string> => ok(n + 10),
      (_n: number): Result<number, string> => err("boom"),
      (n: number): Result<number, string> => {
        thirdCalled = true;
        return ok(n * 100);
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("boom");
    expect(thirdCalled).toBe(false);
  });

  it("passes through initial error without calling any functions", () => {
    let firstCalled = false;

    const result = pipe(
      err("initial-error") as Result<number, string>,
      (n: number): Result<number, string> => {
        firstCalled = true;
        return ok(n + 1);
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("initial-error");
    expect(firstCalled).toBe(false);
  });

  it("preserves error type from failing step", () => {
    const result = pipe(
      ok("hello"),
      (s: string): Result<number, string> => ok(s.length),
      (n: number): Result<number, string> => err(`failed at ${n}`),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("failed at 5");
  });
});
