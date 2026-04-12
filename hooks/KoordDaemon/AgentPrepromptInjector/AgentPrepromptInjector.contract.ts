/**
 * AgentPrepromptInjector Contract — Inject worker preprompt into background agent prompts.
 *
 * Event: PreToolUse (Agent tool)
 *
 * When run_in_background is true in the Agent tool input, reads a worker
 * preprompt template, replaces template variables ({{agent_name}},
 * {{thread_id}}, {{task_description}}), and appends it to the agent prompt
 * via updatedInput.
 *
 * This ensures every background worker agent receives coordination
 * instructions — it is impossible to spawn a Koord worker without them.
 *
 * Template path resolution:
 *   1. hookConfig.koordDaemon.prepromptPath in settings.json
 *   2. {cwd}/src/prompts/worker.md (fallback)
 *
 * Fails open: returns continueOk() on any error.
 *
 * Source: /Users/hogers/Projects/koord/.claude/hooks/AgentPrepromptInjector.hook.js
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { fileExists, readFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  defaultReadFileOrNull,
  extractAgentName,
  extractTask,
  extractThreadId,
  readKoordConfig,
} from "@hooks/hooks/KoordDaemon/shared";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentPrepromptInjectorDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, ResultError>;
  getKoordConfig: () => { prepromptPath: string | null };
  getCwd: () => string;
  stderr: (msg: string) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SEPARATOR = "\n\n---\n\n";

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: AgentPrepromptInjectorDeps = {
  fileExists,
  readFile,
  getKoordConfig: () => readKoordConfig(defaultReadFileOrNull),
  getCwd: () => process.cwd(),
  stderr: defaultStderr,
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const AgentPrepromptInjector: SyncHookContract<ToolHookInput, AgentPrepromptInjectorDeps> = {
  name: "AgentPrepromptInjector",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name !== "Agent") return false;
    const toolInput = input.tool_input || {};
    return toolInput.run_in_background === true;
  },

  execute(
    input: ToolHookInput,
    deps: AgentPrepromptInjectorDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const toolInput = input.tool_input || {};

    // Resolve template path: settings.json config first, then cwd fallback
    const config = deps.getKoordConfig();
    const templatePath = config.prepromptPath ?? `${deps.getCwd()}/src/prompts/worker.md`;

    // Check file exists before attempting read
    if (!deps.fileExists(templatePath)) {
      deps.stderr(`[AgentPrepromptInjector] Template not found: ${templatePath}`);
      return ok({ continue: true });
    }

    // Read the template
    const readResult = deps.readFile(templatePath);
    if (!readResult.ok) {
      deps.stderr(`[AgentPrepromptInjector] Failed to read template: ${readResult.error.message}`);
      return ok({ continue: true });
    }

    const template = readResult.value;

    // Extract template variables from the tool input
    const agentName = extractAgentName(toolInput) || "worker";
    const threadId = extractThreadId(toolInput) || "unknown";
    const taskDesc = extractTask(toolInput) || "Background task";

    // Replace template variables
    const preprompt = template
      .replace(/\{\{agent_name\}\}/g, agentName)
      .replace(/\{\{thread_id\}\}/g, threadId)
      .replace(/\{\{task_description\}\}/g, taskDesc);

    // Build the updated prompt with preprompt appended
    const originalPrompt = typeof toolInput.prompt === "string" ? toolInput.prompt : "";
    const updatedPrompt = originalPrompt + SEPARATOR + preprompt;

    deps.stderr(
      `[AgentPrepromptInjector] Injected worker preprompt for ${agentName} on thread ${threadId}`,
    );

    return ok({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { prompt: updatedPrompt },
      },
    });
  },

  defaultDeps,
};
