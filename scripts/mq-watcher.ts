#!/usr/bin/env bun
/**
 * mq-watcher.ts — Blocking message queue watcher.
 *
 * The primary agent runs this via Bash. It blocks until a new message
 * appears in the queue, then outputs the message and exits. The
 * MessageQueueRelay PostToolUse hook detects the exit and injects
 * context telling the agent to process the message and respawn.
 *
 * Usage: bun scripts/mq-watcher.ts --session <session_id> [--timeout <seconds>]
 *
 * Exit codes:
 *   0 — Message found and output to stdout
 *   1 — Timeout reached with no message
 *   2 — Invalid arguments or missing queue directory
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

// ─── Arg Parsing ────────────────────────────────────────────────────────────

function parseArgs(): { sessionId: string; timeoutMs: number } {
  const args = process.argv.slice(2);
  let sessionId = "";
  let timeoutSeconds = 300; // default 5 minutes

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session" && args[i + 1]) {
      sessionId = args[i + 1];
      i++;
    } else if (args[i] === "--timeout" && args[i + 1]) {
      timeoutSeconds = parseInt(args[i + 1], 10);
      i++;
    }
  }

  if (!sessionId) {
    process.stderr.write("[mq-watcher] --session <session_id> is required\n");
    process.exit(2);
  }

  return { sessionId, timeoutMs: timeoutSeconds * 1000 };
}

// ─── Cursor Management ──────────────────────────────────────────────────────

function readCursor(cursorPath: string): number {
  if (!existsSync(cursorPath)) return 0;
  const raw = readFileSync(cursorPath, "utf-8").trim();
  return parseInt(raw, 10) || 0;
}

function writeCursor(cursorPath: string, value: number): void {
  writeFileSync(cursorPath, String(value));
}

// ─── Poll Loop ──────────────────────────────────────────────────────────────

async function watchForMessage(sessionId: string, timeoutMs: number): Promise<void> {
  const baseDir = `/tmp/pai-mq/${sessionId}`;
  const messagesDir = `${baseDir}/messages`;
  const cursorPath = `${baseDir}/cursor`;

  // Ensure queue dir exists (server may not have started yet)
  mkdirSync(messagesDir, { recursive: true });

  const cursor = readCursor(cursorPath);
  const messagePath = `${messagesDir}/${cursor}.json`;

  process.stderr.write(
    `[mq-watcher] Watching for message ${cursor} (session ${sessionId.slice(0, 8)}...)\n`,
  );

  const deadline = Date.now() + timeoutMs;
  const pollIntervalMs = 200;

  while (Date.now() < deadline) {
    if (existsSync(messagePath)) {
      const content = readFileSync(messagePath, "utf-8");
      // Advance cursor
      writeCursor(cursorPath, cursor + 1);
      // Output message to stdout — the agent/hook will see this
      process.stdout.write(content);
      process.stderr.write(`[mq-watcher] Delivered message ${cursor}\n`);
      process.exit(0);
    }
    await Bun.sleep(pollIntervalMs);
  }

  process.stderr.write(`[mq-watcher] Timeout after ${timeoutMs / 1000}s — no message\n`);
  process.exit(1);
}

// ─── Main ───────────────────────────────────────────────────────────────────

const { sessionId, timeoutMs } = parseArgs();
await watchForMessage(sessionId, timeoutMs);
