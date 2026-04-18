/**
 * Shared environment detection utilities.
 *
 * Canonical location for agent/subagent detection logic.
 * All hooks should import from here rather than inlining env var checks.
 */

import { getEnv as getEnvAdapter } from "@hooks/core/adapters/process";

/** Default getEnv implementation using the process adapter. */
export function getEnvOrUndefined(key: string): string | undefined {
  const result = getEnvAdapter(key);
  return result.ok ? result.value : undefined;
}

/** Detect whether the current session is a subagent (not the primary agent). */
export function isSubagent(getEnv: (key: string) => string | undefined): boolean {
  const projectDir = getEnv("CLAUDE_PROJECT_DIR") ?? "";
  const agentType = getEnv("CLAUDE_AGENT_TYPE") ?? "";
  const subagentFlag = getEnv("CLAUDE_CODE_AGENT_SUBAGENT") ?? "";
  return projectDir.includes("/.claude/Agents/") || agentType !== "" || subagentFlag === "true";
}

/** Convenience: isSubagent using default env getter. */
export function isSubagentDefault(): boolean {
  return isSubagent(getEnvOrUndefined);
}
