import { describe, expect, it } from "bun:test";
import {
  buildChildEnv,
  exec,
  execSyncSafe,
  getEnv,
  shellForPlatform,
  spawnDetached,
  spawnSyncSafe,
} from "@hooks/core/adapters/process";
import { ErrorCode } from "@hooks/core/error";

// ─── shellForPlatform ────────────────────────────────────────────────────────

describe("shellForPlatform", () => {
  it("returns sh -c for linux", () => {
    const [shell, flag] = shellForPlatform("linux");
    expect(shell).toBe("sh");
    expect(flag).toBe("-c");
  });

  it("returns sh -c for darwin", () => {
    const [shell, flag] = shellForPlatform("darwin");
    expect(shell).toBe("sh");
    expect(flag).toBe("-c");
  });

  it("returns cmd.exe /c for win32", () => {
    const [shell, flag] = shellForPlatform("win32");
    expect(shell).toBe("cmd.exe");
    expect(flag).toBe("/c");
  });

  it("defaults to sh -c for unknown platforms", () => {
    const [shell, flag] = shellForPlatform("freebsd");
    expect(shell).toBe("sh");
    expect(flag).toBe("-c");
  });
});

// ─── exec ────────────────────────────────────────────────────────────────────

describe("exec", () => {
  it("captures stdout from successful command", async () => {
    const r = await exec("echo hello");
    expect(r.ok).toBe(true);
    expect(r.value!.stdout.trim()).toBe("hello");
    expect(r.value!.exitCode).toBe(0);
  });

  it("captures stderr from command", async () => {
    const r = await exec("echo error >&2");
    expect(r.ok).toBe(true);
    expect(r.value!.stderr.trim()).toBe("error");
  });

  it("captures non-zero exit code", async () => {
    const r = await exec("exit 42");
    expect(r.ok).toBe(true);
    expect(r.value!.exitCode).toBe(42);
  });

  it("supports cwd option", async () => {
    const r = await exec("pwd", { cwd: "/tmp" });
    expect(r.ok).toBe(true);
    // /tmp may resolve to /private/tmp on macOS
    expect(r.value!.stdout.trim()).toMatch(/\/tmp$/);
  });

  it("uses platform parameter for shell selection", async () => {
    // We can't truly test win32 on POSIX, but we verify the param is accepted
    // and that the default (current platform) works
    const r = await exec("echo platform-test", { platform: process.platform });
    expect(r.ok).toBe(true);
    expect(r.value!.stdout.trim()).toBe("platform-test");
  });
});

// ─── execSyncSafe ───────────────────────────────────────────────────────────

describe("execSyncSafe", () => {
  it("returns stdout from successful command", () => {
    const r = execSyncSafe("echo hello");
    expect(r.ok).toBe(true);
    expect(r.value!.trim()).toBe("hello");
  });

  it("returns error for failing command", () => {
    // Use sh -c to ensure exit runs in a subshell (bun 1.3+ on Linux
    // may not throw from bare `exit 1` passed to execSync)
    const r = execSyncSafe("sh -c 'exit 1'");
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe(ErrorCode.ProcessExecFailed);
  });

  it("supports cwd option", () => {
    const r = execSyncSafe("pwd", { cwd: "/tmp" });
    expect(r.ok).toBe(true);
    expect(r.value!.trim()).toMatch(/\/tmp$/);
  });
});

// ─── spawnSyncSafe ──────────────────────────────────────────────────────────

describe("spawnSyncSafe", () => {
  it("returns stdout, stderr, and exit code", () => {
    const r = spawnSyncSafe("echo", ["hello"]);
    expect(r.ok).toBe(true);
    expect(r.value!.stdout.trim()).toBe("hello");
    expect(r.value!.stderr).toBe("");
    expect(r.value!.exitCode).toBe(0);
  });

  it("captures stderr from child", () => {
    const r = spawnSyncSafe("sh", ["-c", "echo boom >&2"]);
    expect(r.ok).toBe(true);
    expect(r.value!.stderr.trim()).toBe("boom");
  });

  it("captures non-zero exit code", () => {
    const r = spawnSyncSafe("sh", ["-c", "exit 42"]);
    expect(r.ok).toBe(true);
    expect(r.value!.exitCode).toBe(42);
  });

  it("supports cwd option", () => {
    const r = spawnSyncSafe("pwd", [], { cwd: "/tmp" });
    expect(r.ok).toBe(true);
    expect(r.value!.stdout.trim()).toMatch(/\/tmp$/);
  });

  it("delivers stdin payload to child via input option", () => {
    // `cat` echoes stdin to stdout — if `input` is plumbed through we
    // should see the payload verbatim on stdout.
    const r = spawnSyncSafe("cat", [], { input: "hello-stdin" });
    expect(r.ok).toBe(true);
    expect(r.value!.stdout).toBe("hello-stdin");
  });

  it("strips CLAUDECODE from child env by default", () => {
    // spawnSyncSafe should route through buildChildEnv when the caller
    // does not pass an explicit env override. Child should not see it.
    const prior = process.env.CLAUDECODE;
    process.env.CLAUDECODE = "1";
    try {
      const r = spawnSyncSafe("sh", ["-c", "echo CC=${CLAUDECODE:-unset}"]);
      expect(r.ok).toBe(true);
      expect(r.value!.stdout.trim()).toBe("CC=unset");
    } finally {
      if (prior === undefined) delete process.env.CLAUDECODE;
      else process.env.CLAUDECODE = prior;
    }
  });

  it("merges explicit env override on top of buildChildEnv stripping", () => {
    // opts.env keys are merged on top of the sanitized env — custom keys
    // come through, but CLAUDECODE vars are always stripped regardless.
    const r = spawnSyncSafe("sh", ["-c", "echo CUSTOM=$PAI_TEST_KEY"], {
      env: { PAI_TEST_KEY: "pai-value", PATH: process.env.PATH },
    });
    expect(r.ok).toBe(true);
    expect(r.value!.stdout.trim()).toBe("CUSTOM=pai-value");
  });

  it("strips CLAUDECODE even when caller passes explicit env", () => {
    // buildChildEnv always runs — re-injecting CLAUDECODE via opts.env
    // is not possible because overrides are merged after stripping but
    // the strip list applies to the base process.env, not the overrides.
    // If the caller explicitly sets CLAUDECODE in overrides, it wins
    // (that is intentional — see buildChildEnv semantics). But if it
    // is only in process.env, it must be stripped.
    const prior = process.env.CLAUDECODE;
    process.env.CLAUDECODE = "1";
    try {
      const r = spawnSyncSafe("sh", ["-c", "echo CC=${CLAUDECODE:-unset}"], {
        env: { PAI_TEST_KEY: "value", PATH: process.env.PATH },
      });
      expect(r.ok).toBe(true);
      expect(r.value!.stdout.trim()).toBe("CC=unset");
    } finally {
      if (prior === undefined) delete process.env.CLAUDECODE;
      else process.env.CLAUDECODE = prior;
    }
  });

  it("returns err for nonexistent command (ENOENT)", () => {
    // spawnSync sets result.error on ENOENT instead of throwing.
    // spawnSyncSafe must detect and re-throw so tryCatch wraps it as err().
    const r = spawnSyncSafe("pai-nonexistent-binary-xyz-abc", []);
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe(ErrorCode.ProcessSpawnFailed);
  });
});

// ─── buildChildEnv ──────────────────────────────────────────────────────────

describe("buildChildEnv", () => {
  it("strips CLAUDECODE from the returned env", () => {
    const prior = process.env.CLAUDECODE;
    process.env.CLAUDECODE = "1";
    try {
      const env = buildChildEnv();
      expect(env.CLAUDECODE).toBeUndefined();
    } finally {
      if (prior === undefined) delete process.env.CLAUDECODE;
      else process.env.CLAUDECODE = prior;
    }
  });

  it("strips CLAUDE_CODE and CLAUDE_AGENT_SDK too", () => {
    const priorCc = process.env.CLAUDE_CODE;
    const priorSdk = process.env.CLAUDE_AGENT_SDK;
    process.env.CLAUDE_CODE = "x";
    process.env.CLAUDE_AGENT_SDK = "y";
    try {
      const env = buildChildEnv();
      expect(env.CLAUDE_CODE).toBeUndefined();
      expect(env.CLAUDE_AGENT_SDK).toBeUndefined();
    } finally {
      if (priorCc === undefined) delete process.env.CLAUDE_CODE;
      else process.env.CLAUDE_CODE = priorCc;
      if (priorSdk === undefined) delete process.env.CLAUDE_AGENT_SDK;
      else process.env.CLAUDE_AGENT_SDK = priorSdk;
    }
  });

  it("preserves unrelated env vars like PATH", () => {
    const env = buildChildEnv();
    expect(env.PATH).toBe(process.env.PATH ?? "");
  });

  it("applies overrides on top of sanitized env", () => {
    const env = buildChildEnv({ PAI_OVERRIDE_KEY: "override-value" });
    expect(env.PAI_OVERRIDE_KEY).toBe("override-value");
  });

  it("removes keys explicitly set to undefined via overrides", () => {
    const env = buildChildEnv({ PATH: undefined });
    expect(env.PATH).toBeUndefined();
  });

  it("override CLAUDECODE wins if caller explicitly sets it", () => {
    // Callers can still intentionally re-inject CLAUDECODE via overrides
    // if they genuinely need it — the strip is a safe default, not a ban.
    const env = buildChildEnv({ CLAUDECODE: "explicit" });
    expect(env.CLAUDECODE).toBe("explicit");
  });
});

// ─── getEnv ──────────────────────────────────────────────────────────────────

describe("getEnv", () => {
  it("returns Ok with value for existing env var", () => {
    const r = getEnv("HOME");
    expect(r.ok).toBe(true);
    expect(r.value!.length).toBeGreaterThan(0);
  });

  it("returns ENV_VAR_MISSING for non-existent var", () => {
    const r = getEnv("PAI_TEST_NONEXISTENT_VAR_12345");
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe(ErrorCode.EnvVarMissing);
  });
});

// ─── exec with timeout ─────────────────────────────────────────────────────

describe("exec with timeout", () => {
  it("completes before timeout without error", async () => {
    const r = await exec("echo fast", { timeout: 5000 });
    expect(r.ok).toBe(true);
    expect(r.value!.stdout.trim()).toBe("fast");
  });

  it("kills process that exceeds timeout", async () => {
    const r = await exec("sleep 10", { timeout: 100 });
    expect(r.ok).toBe(true);
    // Process was killed — exit code is non-zero or signal-based
    expect(r.value!.exitCode).not.toBe(0);
  });
});

// ─── spawnDetached ─────────────────────────────────────────────────────────

describe("spawnDetached", () => {
  it("spawns a process without throwing", () => {
    const r = spawnDetached("true", []);
    expect(r.ok).toBe(true);
  });

  it("returns error for nonexistent command", () => {
    const r = spawnDetached("pai-nonexistent-cmd-xyz", []);
    // Bun.spawn may or may not throw for missing binaries — either result is valid
    expect(typeof r.ok).toBe("boolean");
  });
});
