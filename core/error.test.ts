import { describe, expect, it } from "bun:test";
import {
  cancelled,
  contractViolation,
  dirCreateFailed,
  ErrorCode,
  envVarMissing,
  fetchFailed,
  fetchTimeout,
  fileNotFound,
  fileReadFailed,
  fileWriteFailed,
  invalidInput,
  jsonParseFailed,
  processExecFailed,
  processSpawnFailed,
  ResultError,
  securityBlock,
  stateCorrupted,
  stdinReadFailed,
  stdinTimeout,
  unknownError,
} from "./error";

// ─── ErrorCode Enum ──────────────────────────────────────────────────────────

describe("ErrorCode", () => {
  it("has 18 error codes", () => {
    const codes = Object.keys(ErrorCode).filter((k) => Number.isNaN(Number(k)));
    expect(codes.length).toBe(18);
  });

  it("all codes are unique string values", () => {
    const values = Object.values(ErrorCode);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

// ─── ResultError Class ──────────────────────────────────────────────────────────

describe("ResultError", () => {
  it("stores code, message, and optional cause", () => {
    const cause = new Error("root");
    const e = new ResultError(ErrorCode.Unknown, "something broke", cause);
    expect(e.code).toBe(ErrorCode.Unknown);
    expect(e.message).toBe("something broke");
    expect(e.cause).toBe(cause);
  });

  it("cause is optional", () => {
    const e = new ResultError(ErrorCode.StdinTimeout, "timeout");
    expect(e.cause).toBeUndefined();
  });

  it("toString formats as [CODE] message", () => {
    const e = new ResultError(ErrorCode.FileNotFound, "missing file");
    expect(e.toString()).toBe("[FILE_NOT_FOUND] missing file");
  });

  it("extends Error for instanceof checks and stack traces", () => {
    const e = new ResultError(ErrorCode.Unknown, "test");
    expect(e instanceof Error).toBe(true);
    expect(e instanceof ResultError).toBe(true);
    expect(e.name).toBe("ResultError");
    expect(e.stack).toBeDefined();
  });
});

// ─── Factory Functions ───────────────────────────────────────────────────────

describe("factory functions", () => {
  it("stdinTimeout creates STDIN_TIMEOUT error", () => {
    const e = stdinTimeout(200);
    expect(e.code).toBe(ErrorCode.StdinTimeout);
    expect(e.message).toContain("200ms");
  });

  it("stdinReadFailed creates STDIN_READ_FAILED with cause", () => {
    const cause = new Error("pipe broken");
    const e = stdinReadFailed(cause);
    expect(e.code).toBe(ErrorCode.StdinReadFailed);
    expect(e.cause).toBe(cause);
  });

  it("jsonParseFailed includes preview of bad input", () => {
    const e = jsonParseFailed("not json", new SyntaxError("bad"));
    expect(e.code).toBe(ErrorCode.JsonParseFailed);
    expect(e.message).toContain("not json");
  });

  it("jsonParseFailed truncates long input to 80 chars", () => {
    const long = "x".repeat(200);
    const e = jsonParseFailed(long, new Error("bad"));
    expect(e.message.length).toBeLessThan(120);
    expect(e.message).toContain("...");
  });

  it("invalidInput creates INVALID_INPUT error", () => {
    const e = invalidInput("missing session_id");
    expect(e.code).toBe(ErrorCode.InvalidInput);
    expect(e.message).toBe("missing session_id");
  });

  it("fileNotFound creates FILE_NOT_FOUND error", () => {
    const e = fileNotFound("/tmp/missing.json");
    expect(e.code).toBe(ErrorCode.FileNotFound);
    expect(e.message).toContain("/tmp/missing.json");
  });

  it("fileReadFailed includes path and cause", () => {
    const e = fileReadFailed("/tmp/bad.json", new Error("EACCES"));
    expect(e.code).toBe(ErrorCode.FileReadFailed);
    expect(e.message).toContain("/tmp/bad.json");
    expect(e.cause).toBeInstanceOf(Error);
  });

  it("fileWriteFailed includes path and cause", () => {
    const e = fileWriteFailed("/tmp/out.json", new Error("ENOSPC"));
    expect(e.code).toBe(ErrorCode.FileWriteFailed);
    expect(e.message).toContain("/tmp/out.json");
  });

  it("dirCreateFailed includes path and cause", () => {
    const e = dirCreateFailed("/tmp/new", new Error("EPERM"));
    expect(e.code).toBe(ErrorCode.DirCreateFailed);
    expect(e.message).toContain("/tmp/new");
  });

  it("processExecFailed includes command", () => {
    const e = processExecFailed("git status", new Error("not found"));
    expect(e.code).toBe(ErrorCode.ProcessExecFailed);
    expect(e.message).toContain("git status");
  });

  it("processSpawnFailed includes command", () => {
    const e = processSpawnFailed("node server.js", new Error("ENOENT"));
    expect(e.code).toBe(ErrorCode.ProcessSpawnFailed);
    expect(e.message).toContain("node server.js");
  });

  it("envVarMissing includes variable name", () => {
    const e = envVarMissing("PAI_DIR");
    expect(e.code).toBe(ErrorCode.EnvVarMissing);
    expect(e.message).toContain("PAI_DIR");
  });

  it("fetchFailed includes URL", () => {
    const e = fetchFailed("https://api.example.com", new Error("ECONNREFUSED"));
    expect(e.code).toBe(ErrorCode.FetchFailed);
    expect(e.message).toContain("api.example.com");
  });

  it("fetchTimeout includes URL and timeout", () => {
    const e = fetchTimeout("https://api.example.com", 5000);
    expect(e.code).toBe(ErrorCode.FetchTimeout);
    expect(e.message).toContain("5000ms");
  });

  it("securityBlock creates SECURITY_BLOCK error", () => {
    const e = securityBlock("blocked by policy");
    expect(e.code).toBe(ErrorCode.SecurityBlock);
    expect(e.message).toBe("blocked by policy");
  });

  it("contractViolation includes hook name", () => {
    const e = contractViolation("SecurityValidator", "missing matcher");
    expect(e.code).toBe(ErrorCode.ContractViolation);
    expect(e.message).toContain("SecurityValidator");
  });

  it("stateCorrupted includes path", () => {
    const e = stateCorrupted("/tmp/state.json", new Error("bad data"));
    expect(e.code).toBe(ErrorCode.StateCorrupted);
    expect(e.message).toContain("/tmp/state.json");
  });

  it("unknownError extracts message from Error", () => {
    const e = unknownError(new Error("surprise"));
    expect(e.code).toBe(ErrorCode.Unknown);
    expect(e.message).toBe("surprise");
  });

  it("unknownError stringifies non-Error", () => {
    const e = unknownError("string error");
    expect(e.code).toBe(ErrorCode.Unknown);
    expect(e.message).toBe("string error");
  });

  it("cancelled creates CANCELLED error", () => {
    const e = cancelled("user abort");
    expect(e.code).toBe(ErrorCode.Cancelled);
    expect(e.message).toBe("user abort");
  });
});

// ─── All 18 factories produce correct codes ──────────────────────────────────

describe("factory → code mapping", () => {
  const mappings: [() => ResultError, ErrorCode][] = [
    [() => stdinTimeout(100), ErrorCode.StdinTimeout],
    [() => stdinReadFailed(null), ErrorCode.StdinReadFailed],
    [() => jsonParseFailed("x", null), ErrorCode.JsonParseFailed],
    [() => invalidInput("x"), ErrorCode.InvalidInput],
    [() => fileNotFound("x"), ErrorCode.FileNotFound],
    [() => fileReadFailed("x", null), ErrorCode.FileReadFailed],
    [() => fileWriteFailed("x", null), ErrorCode.FileWriteFailed],
    [() => dirCreateFailed("x", null), ErrorCode.DirCreateFailed],
    [() => processExecFailed("x", null), ErrorCode.ProcessExecFailed],
    [() => processSpawnFailed("x", null), ErrorCode.ProcessSpawnFailed],
    [() => envVarMissing("x"), ErrorCode.EnvVarMissing],
    [() => fetchFailed("x", null), ErrorCode.FetchFailed],
    [() => fetchTimeout("x", 100), ErrorCode.FetchTimeout],
    [() => securityBlock("x"), ErrorCode.SecurityBlock],
    [() => contractViolation("x", "y"), ErrorCode.ContractViolation],
    [() => stateCorrupted("x", null), ErrorCode.StateCorrupted],
    [() => unknownError("x"), ErrorCode.Unknown],
    [() => cancelled("x"), ErrorCode.Cancelled],
  ];

  it("has 18 factory mappings", () => {
    expect(mappings.length).toBe(18);
  });

  for (const [factory, expectedCode] of mappings) {
    it(`produces ${expectedCode}`, () => {
      expect(factory().code).toBe(expectedCode);
    });
  }
});
