/**
 * HookRunner — The shared pipeline that replaces 30+ lines of boilerplate per hook.
 *
 * Pipeline: stdin → parse → accepts → execute → format → exit
 *
 * This file and the adapters are the ONLY boundary layers where
 * uncaught errors are handled. Everything above (contracts) uses pure Result pipelines.
 */

import { appendHookLog, type HookLogEntry } from "@hooks/core/adapters/log";
import { readStdin } from "@hooks/core/adapters/stdin";
import type { HookContract } from "@hooks/core/contract";
import { ErrorCode, jsonParseFailed, type ResultError } from "@hooks/core/error";
import { ok, type Result, tryCatch } from "@hooks/core/result";
import { isDuplicate } from "@hooks/core/dedup";
import type { HookEventType, HookInput, HookInputBase } from "@hooks/core/types/hook-inputs";
import type { HookOutput } from "@hooks/core/types/hook-outputs";

// ─── Event Resolution ──────────────────────────────────────────────────────

/**
 * Normalize contract.event for logging/formatting.
 * When a contract declares multiple events, infer the actual event from input shape.
 */
function resolveEvent(contractEvent: HookEventType | HookEventType[], input: HookInput): string {
  if (Array.isArray(contractEvent)) {
    if ("prompt" in input) return "UserPromptSubmit";
    if ("tool_name" in input) return "tool_input" in input ? "PreToolUse" : "PostToolUse";
    return contractEvent[0];
  }
  return contractEvent;
}

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
    case "updatedInput":
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: eventName,
          updatedInput: output.updatedInput,
        },
      });
    case "context":
      return output.content;
    case "silent":
      return null;
  }
}

// ─── JSON Parsing ────────────────────────────────────────────────────────────

function parseJson(raw: string): Result<HookInput, ResultError> {
  return tryCatch(
    () => JSON.parse(raw) as HookInput,
    (e) => jsonParseFailed(raw, e),
  );
}

// ─── Pipeline Context ───────────────────────────────────────────────────────

interface PipelineIO {
  write: (msg: string) => void;
  writeErr: (msg: string) => void;
  exit: (code: number) => void;
  checkDuplicate: (hookName: string, sessionId: string, input: HookInput) => boolean;
  log: (entry: HookLogEntry) => void;
  startTime: number;
}

function createPipelineIO(options: RunHookOptions): PipelineIO {
  const writeErr = options.stderr ?? ((msg: string) => process.stderr.write(`${msg}\n`));
  return {
    write: options.stdout ?? ((msg: string) => process.stdout.write(msg)),
    writeErr,
    exit: options.exit ?? ((code: number) => process.exit(code)),
    checkDuplicate: options.isDuplicate ?? isDuplicate,
    log:
      options.appendLog ??
      ((entry: HookLogEntry) => {
        appendHookLog(entry, undefined, undefined, writeErr);
      }),
    startTime: performance.now(),
  };
}

function makeEmitLog(
  io: PipelineIO,
  contract: { name: string; event: HookEventType | HookEventType[] },
  sessionId: string | undefined,
  input?: HookInput,
): (status: HookLogEntry["status"], outputType?: string, error?: string) => void {
  return (status, outputType?, error?) => {
    io.log({
      ts: new Date().toISOString(),
      hook: contract.name,
      event: input ? resolveEvent(contract.event, input) : (Array.isArray(contract.event) ? contract.event[0] : contract.event),
      status,
      duration_ms: Math.round(performance.now() - io.startTime),
      session_id: sessionId,
      ...(error ? { error } : {}),
      ...(outputType ? { output_type: outputType } : {}),
    });
  };
}

// ─── Shared Execute Pipeline ────────────────────────────────────────────────

/**
 * The shared post-parse pipeline: accepts → dedup → execute → format → output.
 *
 * Both runHook and runHookWith call this after obtaining a parsed input.
 * Returns true if the pipeline completed normally, false if it exited early.
 */
async function executePipeline<I extends HookInput, O extends HookOutput, D>(
  contract: HookContract<I, O, D>,
  input: I,
  io: PipelineIO,
  safeExit: () => void,
  opts?: { handleSecurityBlock?: boolean },
): Promise<void> {
  const sessionId = (input as HookInputBase).session_id;
  const emitLog = makeEmitLog(io, contract, sessionId, input);

  if (!contract.accepts(input)) {
    emitLog("skipped");
    safeExit();
    return;
  }

  if (sessionId && io.checkDuplicate(contract.name, sessionId, input)) {
    emitLog("skipped");
    safeExit();
    return;
  }

  const result = await Promise.resolve(contract.execute(input, contract.defaultDeps));

  if (!result.ok) {
    io.writeErr(`[${contract.name}] error: ${result.error.message}`);
    emitLog("error", undefined, result.error.message);

    if (opts?.handleSecurityBlock && result.error.code === ErrorCode.SecurityBlock) {
      io.exit(2);
      return;
    }

    safeExit();
    return;
  }

  const eventName = resolveEvent(contract.event, input);
  const formatted = formatOutput(result.value, eventName);
  if (formatted !== null) {
    io.write(formatted);
  }
  emitLog("ok", result.value.type);
  io.exit(0);
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
  /** Override dedup guard for testing. Return true to skip as duplicate. */
  isDuplicate?: (hookName: string, sessionId: string, input: HookInput) => boolean;
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
  const io = createPipelineIO(options);
  const safeExit = () => io.exit(0);

  await executePipeline(contract, input, io, safeExit).catch((e) => {
    io.writeErr(`[${contract.name}] uncaught: ${e instanceof Error ? e.message : e}`);
    makeEmitLog(io, contract, undefined)("error", undefined, e instanceof Error ? e.message : String(e));
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
  const io = createPipelineIO(options);
  const timeoutMs = options.stdinTimeout ?? 200;
  const events = Array.isArray(contract.event) ? contract.event : [contract.event];
  const isToolEvent = events.includes("PreToolUse") || events.includes("PostToolUse");

  const safeExit = () => {
    if (isToolEvent) {
      io.write(JSON.stringify({ continue: true }));
    }
    io.exit(0);
  };

  const runStdinPipeline = async (): Promise<void> => {
    // Step 1: Read stdin
    let rawResult: Result<string, ResultError>;
    if (options.stdinOverride !== undefined) {
      rawResult = ok(options.stdinOverride);
    } else {
      rawResult = await readStdin(timeoutMs);
    }

    if (!rawResult.ok) {
      io.writeErr(`[${contract.name}] stdin: ${rawResult.error.message}`);
      makeEmitLog(io, contract, undefined)("error", undefined, rawResult.error.message);
      safeExit();
      return;
    }

    // Step 2: Parse JSON
    const inputResult = parseJson(rawResult.value);
    if (!inputResult.ok) {
      io.writeErr(`[${contract.name}] parse: ${inputResult.error.message}`);
      makeEmitLog(io, contract, undefined)("error", undefined, inputResult.error.message);
      safeExit();
      return;
    }

    const input = inputResult.value as I;

    // Step 2.5: Runtime validation — catch settings.json event routing misconfigs
    if (isToolEvent && !("tool_name" in inputResult.value)) {
      const resolvedEvent = resolveEvent(contract.event, input);
      io.writeErr(
        `[${contract.name}] input missing tool_name for ${resolvedEvent} contract — check settings.json event routing`,
      );
      makeEmitLog(io, contract, (input as HookInputBase).session_id, input)("error", undefined, "input missing tool_name");
      safeExit();
      return;
    }

    // Steps 3-5: Shared pipeline
    await executePipeline(contract, input, io, safeExit, { handleSecurityBlock: true });
  };

  await runStdinPipeline().catch((e) => {
    // Top-level safety net — should never reach here if contracts use Result
    io.writeErr(`[${contract.name}] uncaught: ${e instanceof Error ? e.message : e}`);
    makeEmitLog(io, contract, undefined)("error", undefined, e instanceof Error ? e.message : String(e));
    safeExit();
  });
}
