#!/usr/bin/env bun
/**
 * mq-server.ts — Lightweight HTTP message queue server.
 *
 * Spawned detached by the MessageQueueServer hook on SessionStart.
 * Koord daemon (or any client) POSTs messages to this server,
 * which writes them as numbered JSON files for the watcher to pick up.
 *
 * Usage: bun scripts/mq-server.ts --session <session_id> [--port <port>]
 *
 * Endpoints:
 *   POST /message  — Queue a message. Body: { from?: string, body: string, [key]: any }
 *   GET  /health   — Returns 200 OK
 *   GET  /status   — Returns queue stats (message count, cursor position)
 *
 * Queue layout:
 *   /tmp/pai-mq/{session_id}/
 *     port          — server port
 *     pid           — server PID
 *     messages/
 *       0.json      — first message
 *       1.json      — second message
 *       ...
 */

import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "fs";

// ─── Arg Parsing ────────────────────────────────────────────────────────────

function parseArgs(): { sessionId: string; port: number } {
  const args = process.argv.slice(2);
  let sessionId = "";
  let port = 0; // 0 = auto-assign

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session" && args[i + 1]) {
      sessionId = args[i + 1];
      i++;
    } else if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  if (!sessionId) {
    process.stderr.write("[mq-server] --session <session_id> is required\n");
    process.exit(1);
  }

  return { sessionId, port };
}

// ─── Queue Directory Setup ──────────────────────────────────────────────────

function setupQueueDir(sessionId: string): string {
  const baseDir = `/tmp/pai-mq/${sessionId}`;
  const messagesDir = `${baseDir}/messages`;
  mkdirSync(messagesDir, { recursive: true });
  return baseDir;
}

// ─── Message Counter ────────────────────────────────────────────────────────

function getNextMessageIndex(messagesDir: string): number {
  const files = readdirSync(messagesDir).filter((f) => f.endsWith(".json"));
  return files.length;
}

// ─── Server ─────────────────────────────────────────────────────────────────

function startServer(sessionId: string, requestedPort: number): void {
  const baseDir = setupQueueDir(sessionId);
  const messagesDir = `${baseDir}/messages`;

  const server = Bun.serve({
    port: requestedPort,
    fetch(req) {
      const url = new URL(req.url);

      // POST /message — queue a message
      if (req.method === "POST" && url.pathname === "/message") {
        return handleMessage(req, messagesDir);
      }

      // GET /health
      if (req.method === "GET" && url.pathname === "/health") {
        return new Response("ok", { status: 200 });
      }

      // GET /status
      if (req.method === "GET" && url.pathname === "/status") {
        return handleStatus(baseDir, messagesDir);
      }

      return new Response("not found", { status: 404 });
    },
  });

  const actualPort = server.port;

  // Write port and PID files
  writeFileSync(`${baseDir}/port`, String(actualPort));
  writeFileSync(`${baseDir}/pid`, String(process.pid));

  process.stderr.write(
    `[mq-server] Listening on port ${actualPort} for session ${sessionId.slice(0, 8)}...\n`,
  );
}

async function handleMessage(
  req: Request,
  messagesDir: string,
): Promise<Response> {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const index = getNextMessageIndex(messagesDir);
  const message = {
    index,
    ts: new Date().toISOString(),
    ...payload,
  };

  const filePath = `${messagesDir}/${index}.json`;
  writeFileSync(filePath, JSON.stringify(message, null, 2));

  process.stderr.write(`[mq-server] Queued message ${index}\n`);

  return new Response(JSON.stringify({ queued: true, index }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function handleStatus(baseDir: string, messagesDir: string): Response {
  const messageCount = getNextMessageIndex(messagesDir);
  const cursorPath = `${baseDir}/cursor`;
  let cursor = 0;
  if (existsSync(cursorPath)) {
    const raw = readFileSync(cursorPath, "utf-8").trim();
    cursor = parseInt(raw, 10) || 0;
  }

  return new Response(
    JSON.stringify({ messageCount, cursor, pending: messageCount - cursor }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

const { sessionId, port } = parseArgs();
startServer(sessionId, port);
