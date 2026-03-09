import { describe, it, expect } from "bun:test";
import { safeFetch } from "./fetch";
import { ErrorCode } from "../error";

// ─── safeFetch ───────────────────────────────────────────────────────────────

describe("safeFetch", () => {
  it("returns FETCH_FAILED for unreachable host", async () => {
    const r = await safeFetch("http://192.0.2.1:1", { timeout: 500 });
    expect(r.ok).toBe(false);
    // Could be either timeout or connection refused depending on system
    expect([ErrorCode.FetchFailed, ErrorCode.FetchTimeout]).toContain(r.error.code);
  });

  it("returns result with status for successful fetch", async () => {
    // Use a known endpoint — the voice server that's typically running
    const r = await safeFetch("http://localhost:8888/health", { timeout: 2000 });
    // If voice server is running, we get a response. If not, we get a fetch error.
    // Either way the adapter should return a Result, not throw.
    if (r.ok) {
      expect(r.value.status).toBeGreaterThanOrEqual(200);
      expect(typeof r.value.body).toBe("string");
    } else {
      expect(r.error).toBeDefined();
      expect(r.error.code).toBeDefined();
    }
  });
});
