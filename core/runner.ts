/**
 * HookRunner — The shared pipeline that replaces 30+ lines of boilerplate per hook.
 *
 * Pipeline: stdin → parse → accepts → execute → validate → serialize → exit
 *
 * This file and the adapters are the ONLY boundary layers where
 * uncaught errors are handled. Everything above (contracts) uses pure Result pipelines.
 */

import { appendHookLog, type HookLogEntry } from "@hooks/core/adapters/log";
import { readStdin } from "@hooks/core/adapters/stdin";
import type { HookContract } from "@hooks/core/contract";
import { isDuplicate } from "@hooks/core/dedup";
import { ErrorCode, jsonParseFailed, type ResultError } from "@hooks/core/error";
import { ok, type Result, tryCatch } from "@hooks/core/result";
import {
  parseHookInput,
  getEventType as schemaGetEventType,
} from "@hooks/core/types/hook-input-schema";
import type { HookEventType, HookInput, HookInputBase } from "@hooks/core/types/hook-inputs";
import { validateHookOutput } from "@hooks/core/types/hook-output-schema";

// ─── Event Resolution ──────────────────────────────────────────────────────

/**
 * Normalize contract.event for logging/formatting.
 * When a contract declares multiple events, infer the actual event from input shape.
 */
function resolveEvent(contractEvent: HookEventType | HookEventType[], input: HookInput): string {
  if (!Array.isArray(contractEvent)) return contractEvent;
  const parsed = parseHookInput(input);
  if (parsed._tag === "Right") return schemaGetEventType(parsed.right);
  return contractEvent[0];
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
): (
  status: HookLogEntry["status"],
  error?: string,
  outputType?: HookLogEntry["output_type"],
) => void {
  return (status, error?, outputType?) => {
    io.log({
      ts: new Date().toISOString(),
      hook: contract.name,
      event: input
        ? resolveEvent(contract.event, input)
        : Array.isArray(contract.event)
          ? contract.event[0]
          : contract.event,
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
 * The shared post-parse pipeline: accepts → dedup → execute → validate → serialize → output.
 *
 * Both runHook and runHookWith call this after obtaining a parsed input.
 */
async function executePipeline<I extends HookInput, D>(
  contract: HookContract<I, D>,
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
    emitLog("error", result.error.message);

    if (opts?.handleSecurityBlock && result.error.code === ErrorCode.SecurityBlock) {
      io.exit(2);
      return;
    }

    safeExit();
    return;
  }

  // Validate against SDK schema (fail-open safety net)
  const validated = validateHookOutput(result.value);
  if (validated._tag === "Left") {
    io.writeErr(`[${contract.name}] output validation failed: ${validated.left.message}`);
    emitLog("error", `output validation: ${validated.left.message}`);
    io.write(JSON.stringify({ continue: true }));
    io.exit(0);
    return;
  }

  // Direct serialization — contracts return SyncHookJSONOutput, no mapping needed
  // Invariant: "{}" is the canonical silent/no-op shape and never carries semantic
  // meaning. Suppressing it avoids writing empty output to Claude Code's stdin.
  const json = JSON.stringify(result.value);
  const hasOutput = json !== "{}";
  if (hasOutput) {
    io.write(json);
  }
  emitLog("ok", undefined, hasOutput ? "output" : "silent");
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
 */
export async function runHookWith<I extends HookInput, D>(
  contract: HookContract<I, D>,
  input: I,
  options: Omit<RunHookOptions, "stdinOverride" | "stdinTimeout"> = {},
): Promise<void> {
  const io = createPipelineIO(options);
  const safeExit = () => io.exit(0);

  await executePipeline(contract, input, io, safeExit).catch((e) => {
    io.writeErr(`[${contract.name}] uncaught: ${e instanceof Error ? e.message : e}`);
    makeEmitLog(io, contract, undefined)("error", e instanceof Error ? e.message : String(e));
    safeExit();
  });
}

/**
 * Run a hook contract through the standard pipeline.
 *
 * This is the ONLY entry point hooks need. The .hook.ts file becomes:
 *   runHook(MyContract);
 */
export async function runHook<I extends HookInput, D>(
  contract: HookContract<I, D>,
  options: RunHookOptions = {},
): Promise<void> {
  const io = createPipelineIO(options);
  const timeoutMs = options.stdinTimeout ?? 200;
  const events = Array.isArray(contract.event) ? contract.event : [contract.event];
  const contractHandlesToolEvents = events.includes("PreToolUse") || events.includes("PostToolUse");

  let inputIsToolEvent = false;
  let inputParsed = false;

  const safeExit = () => {
    if (inputIsToolEvent || (contractHandlesToolEvents && !inputParsed)) {
      io.write(JSON.stringify({ continue: true }));
    }
    io.exit(0);
  };

  const runStdinPipeline = async (): Promise<void> => {
    let rawResult: Result<string, ResultError>;
    if (options.stdinOverride !== undefined) {
      rawResult = ok(options.stdinOverride);
    } else {
      rawResult = await readStdin(timeoutMs);
    }

    if (!rawResult.ok) {
      io.writeErr(`[${contract.name}] stdin: ${rawResult.error.message}`);
      makeEmitLog(io, contract, undefined)("error", rawResult.error.message);
      safeExit();
      return;
    }

    const inputResult = parseJson(rawResult.value);
    if (!inputResult.ok) {
      io.writeErr(`[${contract.name}] parse: ${inputResult.error.message}`);
      makeEmitLog(io, contract, undefined)("error", inputResult.error.message);
      safeExit();
      return;
    }

    const input = inputResult.value as I;
    inputParsed = true;
    inputIsToolEvent = "tool_name" in inputResult.value;

    if (contractHandlesToolEvents && !inputIsToolEvent && events.length === 1) {
      const resolvedEvent = resolveEvent(contract.event, input);
      io.writeErr(
        `[${contract.name}] input missing tool_name for ${resolvedEvent} contract — check settings.json event routing`,
      );
      makeEmitLog(
        io,
        contract,
        (input as HookInputBase).session_id,
        input,
      )("error", "input missing tool_name");
      safeExit();
      return;
    }

    await executePipeline(contract, input, io, safeExit, {
      handleSecurityBlock: true,
    });
  };

  await runStdinPipeline().catch((e) => {
    io.writeErr(`[${contract.name}] uncaught: ${e instanceof Error ? e.message : e}`);
    makeEmitLog(io, contract, undefined)("error", e instanceof Error ? e.message : String(e));
    safeExit();
  });
}
