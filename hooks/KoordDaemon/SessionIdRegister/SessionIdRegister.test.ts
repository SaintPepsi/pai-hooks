import { describe, expect, test } from "bun:test";
import { invalidInput } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { SessionIdRegister, type SessionIdRegisterDeps } from "./SessionIdRegister.contract";

const mockInput: SessionStartInput = {
  hook_type: "SessionStart",
  session_id: "abc123-def456-ghi789",
};

function makeDeps(overrides: Partial<SessionIdRegisterDeps> = {}): SessionIdRegisterDeps {
  return {
    getEnv: (name) => {
      if (name === "KOORD_THREAD_ID") return "12345678901234567";
      if (name === "KOORD_DAEMON_URL") return "http://localhost:4577";
      return undefined;
    },
    safeFetch: async () => ok({ status: 200, body: "{}", headers: {} }),
    getKoordConfig: () => ({ url: null }),
    stderr: () => {},
    ...overrides,
  };
}

describe("SessionIdRegister", () => {
  test("has correct name and event", () => {
    expect(SessionIdRegister.name).toBe("SessionIdRegister");
    expect(SessionIdRegister.event).toBe("SessionStart");
  });

  test("accepts all inputs", () => {
    expect(SessionIdRegister.accepts(mockInput)).toBe(true);
  });

  test("returns silent when no session_id", async () => {
    const input: SessionStartInput = { hook_type: "SessionStart" };
    const result = await SessionIdRegister.execute(input, makeDeps());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  test("returns silent when no KOORD_THREAD_ID", async () => {
    const deps = makeDeps({
      getEnv: () => undefined,
    });
    const result = await SessionIdRegister.execute(mockInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  test("returns silent when no daemon URL", async () => {
    const deps = makeDeps({
      getEnv: (name) => {
        if (name === "KOORD_THREAD_ID") return "12345678901234567";
        return undefined;
      },
      getKoordConfig: () => ({ url: null }),
    });
    const result = await SessionIdRegister.execute(mockInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  test("posts to /register-session with correct body", async () => {
    let postedUrl = "";
    let postedBody = "";
    const deps = makeDeps({
      safeFetch: async (url, opts) => {
        postedUrl = url;
        postedBody = opts.body ?? "";
        return ok({ status: 200, body: "{}", headers: {} });
      },
    });
    await SessionIdRegister.execute(mockInput, deps);
    expect(postedUrl).toBe("http://localhost:4577/register-session");
    const parsed = JSON.parse(postedBody);
    expect(parsed.sessionId).toBe("abc123-def456-ghi789");
    expect(parsed.threadId).toBe("12345678901234567");
  });

  test("uses settings.json fallback when env URL missing", async () => {
    let postedUrl = "";
    const deps = makeDeps({
      getEnv: (name) => {
        if (name === "KOORD_THREAD_ID") return "12345678901234567";
        return undefined;
      },
      getKoordConfig: () => ({ url: "http://fallback:9999" }),
      safeFetch: async (url) => {
        postedUrl = url;
        return ok({ status: 200, body: "{}", headers: {} });
      },
    });
    await SessionIdRegister.execute(mockInput, deps);
    expect(postedUrl).toBe("http://fallback:9999/register-session");
  });

  test("returns silent even when fetch fails", async () => {
    const deps = makeDeps({
      safeFetch: async () => err(invalidInput("connection refused")),
    });
    const result = await SessionIdRegister.execute(mockInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  test("strips trailing slashes from daemon URL", async () => {
    let postedUrl = "";
    const deps = makeDeps({
      getEnv: (name) => {
        if (name === "KOORD_THREAD_ID") return "12345678901234567";
        if (name === "KOORD_DAEMON_URL") return "http://localhost:4577///";
        return undefined;
      },
      safeFetch: async (url) => {
        postedUrl = url;
        return ok({ status: 200, body: "{}", headers: {} });
      },
    });
    await SessionIdRegister.execute(mockInput, deps);
    expect(postedUrl).toBe("http://localhost:4577/register-session");
  });
});
