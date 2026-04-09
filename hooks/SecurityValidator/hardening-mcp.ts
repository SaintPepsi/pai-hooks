#!/usr/bin/env bun
/**
 * Hardening MCP Server — Purpose-built tool for the hardening agent.
 *
 * Exposes two tools:
 *   - get_blocked_patterns: Returns current bash.blocked entries
 *   - insert_blocked_pattern: Appends a new entry to bash.blocked
 *
 * This is the agent's ONLY way to modify patterns.yaml — no Edit/Write
 * permissions needed. The MCP server is the security boundary.
 *
 * Run via: --mcp-config with --strict-mcp-config
 */

import { readFile, writeFile } from "@hooks/core/adapters/fs";
import { join } from "node:path";
import { ok, err, type Result } from "@hooks/core/result";
import type { ResultError } from "@hooks/core/error";

const PATTERNS_PATH = join(import.meta.dir, "patterns.yaml");
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

// ─── YAML helpers ──────────────────────────────────────────────────────────

function extractBlockedSection(yaml: string): string[] {
  const lines = yaml.split("\n");
  const entries: string[] = [];
  let inBlocked = false;
  let currentEntry = "";

  for (const line of lines) {
    if (/^\s+blocked:/.test(line)) {
      inBlocked = true;
      continue;
    }
    if (inBlocked) {
      if (/^\s{2}\w/.test(line) && !/^\s{4}/.test(line)) break;
      if (/^\s+-\s+pattern:/.test(line)) {
        if (currentEntry) entries.push(currentEntry.trim());
        currentEntry = line + "\n";
      } else if (currentEntry && /^\s+/.test(line)) {
        currentEntry += line + "\n";
      }
    }
  }
  if (currentEntry) entries.push(currentEntry.trim());
  return entries;
}

function insertBlockedEntry(pattern: string, reason: string): Result<string, ResultError> {
  const yamlResult = readFile(PATTERNS_PATH);
  if (!yamlResult.ok) return yamlResult;
  const yaml = yamlResult.value;

  if (yaml.includes(`pattern: "${pattern}"`)) {
    return ok(`Pattern already exists: ${pattern}`);
  }

  const lines = yaml.split("\n");
  let insertIndex = -1;
  let inBlocked = false;

  for (let i = 0; i < Math.min(lines.length, MAX_LINES); i++) {
    if (/^\s+blocked:/.test(lines[i])) {
      inBlocked = true;
      continue;
    }
    if (inBlocked && /^\s{2}\w/.test(lines[i]) && !/^\s{4}/.test(lines[i])) {
      insertIndex = i;
      break;
    }
  }

  if (insertIndex === -1) {
    return err({ code: "INVALID_INPUT", message: "Could not find end of bash.blocked section" } as ResultError);
  }

  const newEntry = [
    `    - pattern: "${pattern}"`,
    `      reason: "${reason}"`,
    "",
  ];

  lines.splice(insertIndex, 0, ...newEntry);
  const writeResult = writeFile(PATTERNS_PATH, lines.join("\n"));
  if (!writeResult.ok) return writeResult;

  return ok(`Inserted blocked pattern: ${pattern}`);
}

// ─── MCP Protocol ──────────────────────────────────────────────────────────

const TOOLS: McpToolDef[] = [
  {
    name: "get_blocked_patterns",
    description: "Returns all current bash.blocked entries from patterns.yaml",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "insert_blocked_pattern",
    description: "Appends a new blocked pattern to bash.blocked in patterns.yaml",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to block (e.g. 'python3.*settings\\\\.json')" },
        reason: { type: "string", description: "Human-readable reason (e.g. 'Auto-hardened: python3 file write (caught 2026-04-10)')" },
      },
      required: ["pattern", "reason"],
    },
  },
];

function handleToolCall(name: string, args: Record<string, string>): McpToolResult {
  if (name === "get_blocked_patterns") {
    const yamlResult = readFile(PATTERNS_PATH);
    if (!yamlResult.ok) return { content: [{ type: "text", text: `Error: ${yamlResult.error.message}` }], isError: true };
    const entries = extractBlockedSection(yamlResult.value);
    return { content: [{ type: "text", text: entries.join("\n\n") }] };
  }

  if (name === "insert_blocked_pattern") {
    const { pattern, reason } = args;
    if (!pattern || !reason) {
      return { content: [{ type: "text", text: "Error: pattern and reason are required" }], isError: true };
    }
    const result = insertBlockedEntry(pattern, reason);
    if (!result.ok) {
      return { content: [{ type: "text", text: `Error: ${result.error.message}` }], isError: true };
    }
    return { content: [{ type: "text", text: result.value }] };
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
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
      return handleToolCall(request.params?.name ?? "", request.params?.arguments ?? {});
    default:
      return { error: { code: -32601, message: `Unknown method: ${request.method}` } };
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
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  }
}

main();
