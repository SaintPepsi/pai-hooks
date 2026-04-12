#!/usr/bin/env bun

/**
 * Hardening MCP Server — Purpose-built tool for the hardening agent.
 *
 * Exposes two tools:
 *   - get_blocked_patterns: Returns current bash.blocked entries
 *   - insert_blocked_pattern: Appends a new entry to bash.blocked
 *
 * This is the agent's ONLY way to modify patterns.json — no Edit/Write
 * permissions needed. The MCP server is the security boundary.
 *
 * Run via: --mcp-config with --strict-mcp-config
 */

import { join } from "node:path";
import { readFile, writeFile } from "@hooks/core/adapters/fs";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { PatternsConfig } from "@hooks/hooks/SecurityValidator/patterns-schema";
import { decodePatternsConfig } from "@hooks/hooks/SecurityValidator/patterns-schema";

const PATTERNS_PATH = join(import.meta.dir, "patterns.json");
const MAX_LINES = 10_000;

// ─── Types ─────────────────────────────────────────────────────────────────

interface McpRequest {
  method: string;
  params?: { name?: string; arguments?: Record<string, string> };
  id?: number | string;
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: "string"; description: string }>;
    required: string[];
  };
}

interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// ─── JSON helpers ──────────────────────────────────────────────────────────

function loadPatterns(): Result<PatternsConfig, ResultError> {
  const jsonResult = readFile(PATTERNS_PATH);
  if (!jsonResult.ok) return jsonResult;

  const config = decodePatternsConfig(jsonResult.value);
  if (!config) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Failed to decode patterns.json",
      } as ResultError,
    };
  }
  return ok(config);
}

function getBlockedEntries(): string[] {
  const result = loadPatterns();
  if (!result.ok) return [];
  return result.value.bash.blocked.map(
    (entry) =>
      `pattern: "${entry.pattern}" reason: "${entry.reason}"${entry.group ? ` group: "${entry.group}"` : ""}`,
  );
}

function getValidGroups(): string[] {
  const result = loadPatterns();
  if (!result.ok) return [];
  const groups = new Set<string>();
  for (const entry of result.value.bash.blocked) {
    if (entry.group) groups.add(entry.group);
  }
  return [...groups];
}

function insertBlockedEntry(
  pattern: string,
  reason: string,
  group: string,
): Result<string, ResultError> {
  const configResult = loadPatterns();
  if (!configResult.ok) return configResult;
  const config = configResult.value;

  const exists = config.bash.blocked.some((entry) => entry.pattern === pattern);
  if (exists) return ok(`Pattern already exists: ${pattern}`);

  const validGroups = getValidGroups();
  if (!validGroups.includes(group)) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: `Invalid group "${group}". Valid groups: ${validGroups.join(", ")}`,
      } as ResultError,
    };
  }

  config.bash.blocked.push({ pattern, reason, group });

  const writeResult = writeFile(PATTERNS_PATH, `${JSON.stringify(config, null, 2)}\n`);
  if (!writeResult.ok) return writeResult;

  return ok(`Inserted blocked pattern: ${pattern} (group: ${group})`);
}

// ─── MCP Protocol ──────────────────────────────────────────────────────────

const TOOLS: McpToolDef[] = [
  {
    name: "get_blocked_patterns",
    description: "Returns all current bash.blocked entries from patterns.json",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "insert_blocked_pattern",
    description:
      "Appends a new blocked pattern to bash.blocked in patterns.json. Call get_blocked_patterns first to see valid groups.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to block (e.g. 'python3.*settings\\\\.json')",
        },
        reason: {
          type: "string",
          description:
            "Human-readable reason (e.g. 'Auto-hardened: python3 file write (caught 2026-04-10)')",
        },
        group: {
          type: "string",
          description: "Group name — must match an existing group from get_blocked_patterns",
        },
      },
      required: ["pattern", "reason", "group"],
    },
  },
];

function handleToolCall(name: string, args: Record<string, string>): McpToolResult {
  if (name === "get_blocked_patterns") {
    const entries = getBlockedEntries();
    return { content: [{ type: "text", text: entries.join("\n") }] };
  }

  if (name === "insert_blocked_pattern") {
    const { pattern, reason, group } = args;
    if (!pattern || !reason || !group) {
      return {
        content: [
          {
            type: "text",
            text: "Error: pattern, reason, and group are required",
          },
        ],
        isError: true,
      };
    }
    const result = insertBlockedEntry(pattern, reason, group);
    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Error: ${result.error.message}` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: result.value }] };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
}

function handleRequest(request: McpRequest): Record<string, unknown> | null {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "hardening-mcp", version: "1.0.0" },
      };
    case "notifications/initialized":
      return null;
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return handleToolCall(
        request.params?.name ?? "",
        request.params?.arguments ?? {},
      ) as unknown as Record<string, unknown>;
    default:
      return {
        error: { code: -32601, message: `Unknown method: ${request.method}` },
      };
  }
}

// ─── Stdio transport ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (let reads = 0; reads < MAX_LINES; reads++) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const segments = buffer.split("\n");
    buffer = segments.pop() ?? "";

    for (const segment of segments) {
      if (!segment.trim()) continue;
      const parsed = JSON.parse(segment) as McpRequest;
      const result = handleRequest(parsed);
      if (result === null) continue;
      const response = { jsonrpc: "2.0", id: parsed.id, result };
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
}

main();
