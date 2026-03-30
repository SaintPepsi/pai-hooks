/**
 * Shared environment detection utilities.
 *
 * Canonical location for agent/subagent detection logic.
 * All hooks should import from here rather than inlining env var checks.
 */

/** Detect whether the current session is a subagent (not the primary agent). */
export function isSubagent(getEnv: (key: string) => string | undefined): boolean {
  const projectDir = getEnv("CLAUDE_PROJECT_DIR") ?? "";
  const agentType = getEnv("CLAUDE_AGENT_TYPE") ?? "";
  const subagentFlag = getEnv("CLAUDE_CODE_AGENT_SUBAGENT") ?? "";
  return projectDir.includes("/.claude/Agents/") || agentType !== "" || subagentFlag === "true";
}
