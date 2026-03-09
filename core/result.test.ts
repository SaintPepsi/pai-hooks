import { describe, it, expect } from "bun:test";
import {
  ok,
  err,
  andThen,
  map,
  mapError,
  match,
  unwrapOr,
  collectResults,
  partitionResults,
  tryCatch,
  tryCatchAsync,
  type Result,
} from "./result";

// ─── Constructors ────────────────────────────────────────────────────────────

describe("ok", () => {
  it("creates Ok result with value", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(42);
  });

  it("works with complex types", () => {
    const r = ok({ name: "test", items: [1, 2] });
    expect(r.ok).toBe(true);
    expect(r.value.name).toBe("test");
  });
});

describe("err", () => {
  it("creates Err result with error", () => {
    const r = err("bad");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("bad");
  });

  it("works with Error objects", () => {
    const e = new Error("fail");
    const r = err(e);
    expect(r.ok).toBe(false);
    expect(r.error.message).toBe("fail");
  });
});

// ─── andThen ─────────────────────────────────────────────────────────────────

describe("andThen", () => {
  it("chains on Ok, passing value to next function", () => {
    const r = andThen(ok(10), (v) => ok(v * 2));
    expect(r.ok).toBe(true);
    expect(r.value).toBe(20);
  });

  it("short-circuits on Err, skipping the function", () => {
    const r = andThen(err("fail") as Result<number, string>, (v) => ok(v * 2));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("fail");
  });

  it("can chain into Err from Ok", () => {
    const r = andThen(ok(10), (_v) => err("nope"));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("nope");
  });

  it("supports multi-step chaining", () => {
    const step1 = ok(5);
    const step2 = andThen(step1, (v) => ok(v + 3));
    const step3 = andThen(step2, (v) => ok(v * 2));
    expect(step3.ok).toBe(true);
    expect(step3.value).toBe(16);
  });
});

// ─── map ─────────────────────────────────────────────────────────────────────

describe("map", () => {
  it("transforms Ok value", () => {
    const r = map(ok("hello"), (s) => s.toUpperCase());
    expect(r.ok).toBe(true);
    expect(r.value).toBe("HELLO");
  });

  it("passes Err through unchanged", () => {
    const r = map(err("fail") as Result<string, string>, (s) => s.toUpperCase());
    expect(r.ok).toBe(false);
    expect(r.error).toBe("fail");
  });
});

// ─── mapError ────────────────────────────────────────────────────────────────

describe("mapError", () => {
  it("transforms Err value", () => {
    const r = mapError(err("fail"), (e) => `wrapped: ${e}`);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("wrapped: fail");
  });

  it("passes Ok through unchanged", () => {
    const r = mapError(ok(42) as Result<number, string>, (e) => `wrapped: ${e}`);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(42);
  });
});

// ─── match ───────────────────────────────────────────────────────────────────

describe("match", () => {
  it("calls ok handler for Ok result", () => {
    const r = match(ok(10), {
      ok: (v) => `value: ${v}`,
      err: (e) => `error: ${e}`,
    });
    expect(r).toBe("value: 10");
  });

  it("calls err handler for Err result", () => {
    const r = match(err("bad"), {
      ok: (v) => `value: ${v}`,
      err: (e) => `error: ${e}`,
    });
    expect(r).toBe("error: bad");
  });
});

// ─── unwrapOr ────────────────────────────────────────────────────────────────

describe("unwrapOr", () => {
  it("returns value for Ok", () => {
    expect(unwrapOr(ok(42), 0)).toBe(42);
  });

  it("returns default for Err", () => {
    expect(unwrapOr(err("fail"), 0)).toBe(0);
  });
});

// ─── collectResults ──────────────────────────────────────────────────────────

describe("collectResults", () => {
  it("collects all Ok values into array", () => {
    const results = [ok(1), ok(2), ok(3)];
    const collected = collectResults(results);
    expect(collected.ok).toBe(true);
    expect(collected.value).toEqual([1, 2, 3]);
  });

  it("returns first Err on failure", () => {
    const results: Result<number, string>[] = [ok(1), err("fail"), ok(3)];
    const collected = collectResults(results);
    expect(collected.ok).toBe(false);
    expect(collected.error).toBe("fail");
  });

  it("handles empty array", () => {
    const collected = collectResults([]);
    expect(collected.ok).toBe(true);
    expect(collected.value).toEqual([]);
  });
});

// ─── partitionResults ────────────────────────────────────────────────────────

describe("partitionResults", () => {
  it("separates Ok and Err values", () => {
    const results: Result<number, string>[] = [ok(1), err("a"), ok(2), err("b")];
    const { oks, errs } = partitionResults(results);
    expect(oks).toEqual([1, 2]);
    expect(errs).toEqual(["a", "b"]);
  });

  it("handles all Ok", () => {
    const { oks, errs } = partitionResults([ok(1), ok(2)]);
    expect(oks).toEqual([1, 2]);
    expect(errs).toEqual([]);
  });

  it("handles all Err", () => {
    const { oks, errs } = partitionResults([err("a"), err("b")]);
    expect(oks).toEqual([]);
    expect(errs).toEqual(["a", "b"]);
  });

  it("handles empty array", () => {
    const { oks, errs } = partitionResults([]);
    expect(oks).toEqual([]);
    expect(errs).toEqual([]);
  });
});

// ─── tryCatch ────────────────────────────────────────────────────────────────

describe("tryCatch", () => {
  it("returns Ok for successful function", () => {
    const r = tryCatch(
      () => JSON.parse('{"a":1}'),
      (e) => String(e),
    );
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ a: 1 });
  });

  it("returns Err for throwing function", () => {
    const r = tryCatch(
      () => JSON.parse("not json"),
      (e) => `parse error: ${e instanceof Error ? e.message : e}`,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("parse error");
  });
});

// ─── tryCatchAsync ───────────────────────────────────────────────────────────

describe("tryCatchAsync", () => {
  it("returns Ok for resolved promise", async () => {
    const r = await tryCatchAsync(
      async () => 42,
      (e) => String(e),
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe(42);
  });

  it("returns Err for rejected promise", async () => {
    const r = await tryCatchAsync(
      async () => { throw new Error("async fail"); },
      (e) => e instanceof Error ? e.message : String(e),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("async fail");
  });

  it("returns Err for thrown sync error in async fn", async () => {
    const r = await tryCatchAsync(
      async () => JSON.parse("bad"),
      (e) => "caught",
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("caught");
  });
});
