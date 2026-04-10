#!/usr/bin/env bun
/**
 * Hardening Agent Runner — Spawns a Claude agent to add blocked patterns.
 *
 * Uses spawnAgent() from lib/spawn-agent.ts for lock management,
 * traceability logging, and background spawning. Configures the agent
 * with MCP-only tools via --strict-mcp-config.
 *
 * Importable function + CLI entry point.
 *
 * Usage:
 *   bun hooks/SecurityValidator/run-hardening.ts "python3 -c 'write settings'"
 *   bun hooks/SecurityValidator/run-hardening.ts --dry-run "some bypass command"
 */

import { join } from "node:path";
import { buildHardeningPrompt } from "@hooks/hooks/SecurityValidator/SettingsRevert/hardening-prompt";
import { spawnAgent, type SpawnAgentConfig, type SpawnAgentDeps } from "@hooks/lib/spawn-agent";
import type { Result } from "@hooks/core/result";
import type { ResultError } from "@hooks/core/error";
import { getPaiDir } from "@hooks/lib/paths";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface HardeningDeps {
  spawnAgent: (config: SpawnAgentConfig, deps?: SpawnAgentDeps) => Result<void, ResultError>;
  stderr: (msg: string) => void;
  baseDir: string;
  mcpConfigPath: string;
  settingsPath: string;
}

// ─── Defaults ──────────────────────────────────────────────────────────────

const defaultDeps: HardeningDeps = {
  spawnAgent,
  stderr: (msg) => process.stderr.write(`${msg}\n`),
  baseDir: getPaiDir(),
  mcpConfigPath: join(import.meta.dir, "hardening-mcp-config.json"),
  settingsPath: join(import.meta.dir, "hardening-agent-settings.json"),
};

// ─── Public API ────────────────────────────────────────────────────────────

export function runHardening(
  bypassCommand: string,
  deps: HardeningDeps = defaultDeps,
): Result<void, ResultError> {
  const prompt = buildHardeningPrompt(bypassCommand);

  deps.stderr(`[run-hardening] Spawning hardening agent for: ${bypassCommand.slice(0, 100)}`);

  return deps.spawnAgent({
    prompt,
    lockPath: "/tmp/pai-hardening-agent.lock",
    logPath: join(deps.baseDir, "MEMORY/SECURITY/hardening-log.jsonl"),
    source: "SettingsRevert",
    reason: `bypass: ${bypassCommand.slice(0, 200)}`,
    maxTurns: 5,
    timeout: 120_000,
    cwd: "/tmp",
    claudeArgs: [
      "--setting-sources", "",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--mcp-config", deps.mcpConfigPath,
      "--settings", deps.settingsPath,
      "--permission-mode", "dontAsk",
    ],
  });
}

// ─── CLI entry point ───────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const bypassCommand = args.find((a) => !a.startsWith("--"));

  if (!bypassCommand) {
    process.stderr.write("Usage: bun hooks/SecurityValidator/run-hardening.ts <bypass-command>\n");
    process.exit(1);
  }

  const result = runHardening(bypassCommand);

  if (result.ok) {
    process.stdout.write("Hardening agent spawned in background.\n");
  } else {
    process.stderr.write(`Failed: ${result.error.message}\n`);
    process.exit(1);
  }
}
