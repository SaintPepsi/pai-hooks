import { describe, expect, it } from "bun:test";
import { ok, err } from "@hooks/core/result";
import { processSpawnFailed } from "@hooks/core/error";
import { runHardening, type HardeningDeps } from "@hooks/hooks/SecurityValidator/run-hardening";
import type { SpawnAgentConfig } from "@hooks/lib/spawn-agent";

function fakeDeps(overrides: Partial<HardeningDeps> = {}): HardeningDeps & { _captured: SpawnAgentConfig[] } {
  const captured: SpawnAgentConfig[] = [];
  return {
    spawnAgent: (config) => { captured.push(config); return ok(undefined as void); },
    stderr: () => {},
    baseDir: "/fake/pai",
    mcpConfigPath: "/fake/mcp-config.json",
    settingsPath: "/fake/settings.json",
    _captured: captured,
    ...overrides,
  };
}

describe("runHardening", () => {
  it("calls spawnAgent with bypass command in prompt", () => {
    const deps = fakeDeps();
    runHardening("python3 evil", deps);

    expect(deps._captured.length).toBe(1);
    expect(deps._captured[0].prompt).toContain("python3 evil");
    expect(deps._captured[0].prompt).toContain("insert_blocked_pattern");
  });

  it("sets correct lockPath, logPath, and cwd", () => {
    const deps = fakeDeps();
    runHardening("jq . settings.json", deps);

    expect(deps._captured[0].lockPath).toBe("/tmp/pai-hardening-agent.lock");
    expect(deps._captured[0].logPath).toContain("MEMORY/SECURITY/hardening-log.jsonl");
    expect(deps._captured[0].cwd).toContain("hooks/SecurityValidator");
  });

  it("passes MCP config via claudeArgs", () => {
    const deps = fakeDeps();
    runHardening("evil cmd", deps);

    const args = deps._captured[0].claudeArgs ?? [];
    expect(args).toContain("--setting-sources");
    expect(args).toContain("--disable-slash-commands");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--mcp-config");
    expect(args).toContain("/fake/mcp-config.json");
    expect(args).toContain("--settings");
    expect(args).toContain("/fake/settings.json");
    expect(args).toContain("--permission-mode");
    expect(args).toContain("dontAsk");
  });

  it("sets source to SettingsRevert", () => {
    const deps = fakeDeps();
    runHardening("evil cmd", deps);

    expect(deps._captured[0].source).toBe("SettingsRevert");
  });

  it("sets maxTurns to 3 and timeout to 120s", () => {
    const deps = fakeDeps();
    runHardening("evil cmd", deps);

    expect(deps._captured[0].maxTurns).toBe(5);
    expect(deps._captured[0].timeout).toBe(120_000);
  });

  it("truncates long bypass commands in reason", () => {
    const longCmd = "x".repeat(300);
    const deps = fakeDeps();
    runHardening(longCmd, deps);

    expect(deps._captured[0].reason.length).toBeLessThan(220);
  });

  it("returns error when spawnAgent fails", () => {
    const deps = fakeDeps({
      spawnAgent: () => err(processSpawnFailed("claude", new Error("spawn failed"))),
    });
    const result = runHardening("evil cmd", deps);

    expect(result.ok).toBe(false);
  });

  it("returns ok when spawnAgent succeeds", () => {
    const deps = fakeDeps();
    const result = runHardening("evil cmd", deps);

    expect(result.ok).toBe(true);
  });
});
