/**
 * HookRunner — The shared pipeline that replaces 30+ lines of boilerplate per hook.
 *
 * Pipeline: stdin → parse → accepts → execute → format → exit
 *
 * This file and the adapters are the ONLY boundary layers where
 * uncaught errors are handled. Everything above (contracts) uses pure Result pipelines.
 */

import type { HookContract } from "@hooks/core/contract";
import type { HookInput, HookInputBase } from "@hooks/core/types/hook-inputs";
import type { HookOutput } from "@hooks/core/types/hook-outputs";
import { readStdin } from "@hooks/core/adapters/stdin";
import { type Result, ok, tryCatch } from "@hooks/core/result";
import { type PaiError, ErrorCode, jsonParseFailed } from "@hooks/core/error";
import { appendHookLog, type HookLogEntry } from "@hooks/core/adapters/log";

// ─── Output Formatting ──────────────────────────────────────────────────────

/**
 * Format a HookOutput to the stdout JSON that Claude Code expects.
 *
 * Claude Code reads additionalContext from hookSpecificOutput, not the top level.
 * See: https://code.claude.com/docs/en/hooks#posttooluse-decision-control
 *
 * Output shapes by type:
 * - continue (no context) → { continue: true }
 * - continue (with context) → { hookSpecificOutput: { hookEventName, additionalContext } }
 * - block (PreToolUse) → { hookSpecificOutput: { hookEventName, permissionDecision: "deny", permissionDecisionReason } }
 * - block (PostToolUse+) → { decision: "block", reason }
 * - ask → { decision: "ask", message }
 * - context → raw string (no JSON wrapper)
 * - silent → no output
 */
function formatOutput(output: HookOutput, eventName: string): string | null {
  switch (output.type) {
    case "continue": {
      if (output.additionalContext !== undefined) {
        return JSON.stringify({
          hookSpecificOutput: {
            hookEventName: eventName,
            additionalContext: output.additionalContext,
          },
        });
      }
      return JSON.stringify({ continue: true });
    }
    case "block": {
      if (eventName === "PreToolUse") {
        return JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: output.reason,
          },
        });
      }
      return JSON.stringify({ decision: "block", reason: output.reason });
    }
    case "ask":
      return JSON.stringify({ decision: "ask", message: output.message });
    case "context":
      return output.content;
    case "silent":
      return null;
  }
}

// ─── JSON Parsing ────────────────────────────────────────────────────────────

function parseJson(raw: string): Result<HookInput, PaiError> {
  return tryCatch(
    () => JSON.parse(raw) as HookInput,
    (e) => jsonParseFailed(raw, e),
  );
}

// ─── The Runner ──────────────────────────────────────────────────────────────

export interface RunHookOptions {
  /** Stdin timeout in milliseconds. Default: 200. */
  stdinTimeout?: number;
  /** Override stdout for testing. */
  stdout?: (msg: string) => void;
  /** Override stderr for testing. */
  stderr?: (msg: string) => void;
  /** Override exit for testing. */
  exit?: (code: number) => void;
  /** Override stdin reader for testing. Bypasses readStdin. */
  stdinOverride?: string;
  /** Override log writer for testing. */
  appendLog?: (entry: HookLogEntry) => void;
}

/**
 * Run a hook contract with a pre-built input, skipping stdin.
 *
 * Use this when the shell hook reads and enriches stdin before
 * passing to the contract (e.g., ResponseTabReset parses the
 * transcript and attaches parsed data to the input).
 */
export async function runHookWith<I extends HookInput, O extends HookOutput, D>(
  contract: HookContract<I, O, D>,
  input: I,
  options: Omit<RunHookOptions, "stdinOverride" | "stdinTimeout"> = {},
): Promise<void> {
  const write = options.stdout ?? ((msg: string) => process.stdout.write(msg));
  const writeErr = options.stderr ?? ((msg: string) => process.stderr.write(msg + "\n"));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const log = options.appendLog ?? ((entry: HookLogEntry) => { appendHookLog(entry, undefined, undefined, writeErr); });
  const startTime = performance.now();
  let sessionId: string | undefined;

  const safeExit = () => { exit(0); };

  const emitLog = (status: HookLogEntry["status"], outputType?: string, error?: string) => {
    log({
      ts: new Date().toISOString(),
      hook: contract.name,
      event: contract.event,
      status,
      duration_ms: Math.round(performance.now() - startTime),
      session_id: sessionId,
      ...(error ? { error } : {}),
      ...(outputType ? { output_type: outputType } : {}),
    });
  };

  const runPipeline = async (): Promise<void> => {
    sessionId = (input as HookInputBase).session_id;

    if (!contract.accepts(input)) {
      emitLog("skipped");
      safeExit();
      return;
    }

    const result = await Promise.resolve(contract.execute(input, contract.defaultDeps));

    if (!result.ok) {
      writeErr(`[${contract.name}] error: ${result.error.message}`);
      emitLog("error", undefined, result.error.message);
      safeExit();
      return;
    }

    const formatted = formatOutput(result.value, contract.event);
    if (formatted !== null) {
      write(formatted);
    }
    emitLog("ok", result.value.type);
    exit(0);
  };

  await runPipeline().catch((e) => {
    writeErr(`[${contract.name}] uncaught: ${e instanceof Error ? e.message : e}`);
    emitLog("error", undefined, e instanceof Error ? e.message : String(e));
    safeExit();
  });
}

/**
 * Run a hook contract through the standard pipeline.
 *
 * This is the ONLY entry point hooks need. The .hook.ts file becomes:
 *   runHook(MyContract);
 */
export async function runHook<I extends HookInput, O extends HookOutput, D>(
  contract: HookContract<I, O, D>,
  options: RunHookOptions = {},
): Promise<void> {
  const write = options.stdout ?? ((msg: string) => process.stdout.write(msg));
  const writeErr = options.stderr ?? ((msg: string) => process.stderr.write(msg + "\n"));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = options.stdinTimeout ?? 200;
  const log = options.appendLog ?? ((entry: HookLogEntry) => { appendHookLog(entry, undefined, undefined, writeErr); });
  const startTime = performance.now();
  let sessionId: string | undefined;

  const isToolEvent = contract.event === "PreToolUse" || contract.event === "PostToolUse";

  const safeExit = () => {
    if (isToolEvent) {
      write(JSON.stringify({ continue: true }));
    }
    exit(0);
  };

  const emitLog = (status: HookLogEntry["status"], outputType?: string, error?: string) => {
    log({
      ts: new Date().toISOString(),
      hook: contract.name,
      event: contract.event,
      status,
      duration_ms: Math.round(performance.now() - startTime),
      session_id: sessionId,
      ...(error ? { error } : {}),
      ...(outputType ? { output_type: outputType } : {}),
    });
  };

  const runPipeline = async (): Promise<void> => {
    // Step 1: Read stdin
    let rawResult: Result<string, PaiError>;
    if (options.stdinOverride !== undefined) {
      rawResult = ok(options.stdinOverride);
    } else {
      rawResult = await readStdin(timeoutMs);
    }

    if (!rawResult.ok) {
      writeErr(`[${contract.name}] stdin: ${rawResult.error.message}`);
      emitLog("error", undefined, rawResult.error.message);
      safeExit();
      return;
    }

    // Step 2: Parse JSON
    const inputResult = parseJson(rawResult.value);
    if (!inputResult.ok) {
      writeErr(`[${contract.name}] parse: ${inputResult.error.message}`);
      emitLog("error", undefined, inputResult.error.message);
      safeExit();
      return;
    }

    const input = inputResult.value as I;
    sessionId = (input as HookInputBase).session_id;

    // Step 2.5: Runtime validation — catch settings.json event routing misconfigs
    if (isToolEvent && !("tool_name" in inputResult.value)) {
      writeErr(`[${contract.name}] input missing tool_name for ${contract.event} contract — check settings.json event routing`);
      emitLog("error", undefined, "input missing tool_name");
      safeExit();
      return;
    }

    // Step 3: accepts() gate — ISP
    if (!contract.accepts(input)) {
      emitLog("skipped");
      safeExit();
      return;
    }

    // Step 4: execute() — SRP core with DIP deps
    const result = await Promise.resolve(contract.execute(input, contract.defaultDeps));

    if (!result.ok) {
      writeErr(`[${contract.name}] error: ${result.error.message}`);
      emitLog("error", undefined, result.error.message);

      // Security blocks exit with code 2 — fail closed, not fail open
      if (result.error.code === ErrorCode.SecurityBlock) {
        exit(2);
        return;
      }

      safeExit();
      return;
    }

    // Step 5: Format output — pass event name for hookSpecificOutput wrapping
    const formatted = formatOutput(result.value, contract.event);
    if (formatted !== null) {
      write(formatted);
    }
    emitLog("ok", result.value.type);
    exit(0);
  };

  await runPipeline().catch((e) => {
    // Top-level safety net — should never reach here if contracts use Result
    writeErr(`[${contract.name}] uncaught: ${e instanceof Error ? e.message : e}`);
    emitLog("error", undefined, e instanceof Error ? e.message : String(e));
    safeExit();
  });
}
