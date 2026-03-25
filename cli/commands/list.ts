/**
 * list command — Show installed hooks from the lockfile.
 *
 * Reads paih.lock.json via shared cli/core/lockfile.ts, checks file status,
 * and displays hook info in table or JSON format.
 *
 * Uses resolveTarget from cli/core/target.ts for --in flag / CWD walk-up.
 */

import type { Result } from "@hooks/cli/core/result";
import { ok, err } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { PaihErrorCode } from "@hooks/cli/core/error";
import type { ParsedArgs } from "@hooks/cli/core/args";
import type { CliDeps } from "@hooks/cli/types/deps";
import type { Lockfile, LockfileHookEntry } from "@hooks/cli/types/lockfile";
import { readLockfile } from "@hooks/cli/core/lockfile";
import { resolveTarget } from "@hooks/cli/core/target";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ListEntry {
  name: string;
  group: string;
  event: string;
  outputMode: string;
  status: "ok" | "MISSING";
}

// ─── Command ─────────────────────────────────────────────────────────────────

export function list(
  args: ParsedArgs,
  deps: CliDeps,
): Result<string, PaihError> {
  // Resolve target: --in flag or CWD walk-up
  const inPath = args.flags.in as string | undefined;
  const targetResult = resolveTarget(deps, inPath);
  if (!targetResult.ok) return targetResult;

  const claudeDir = `${targetResult.value}/.claude`;

  // Read lockfile via shared module
  const lockResult = readLockfile(claudeDir, deps);
  if (!lockResult.ok) {
    // LOCK_CORRUPT → stderr error
    if (args.flags.json) {
      return err(lockResult.error);
    }
    return err(lockResult.error);
  }

  const lockfile = lockResult.value;

  // No lockfile or empty hooks → empty state
  if (!lockfile || lockfile.hooks.length === 0) {
    if (args.flags.json) {
      return ok("[]");
    }
    return ok("No hooks installed. Run paih install to get started.");
  }

  // Build entries with status
  const entries = buildEntries(lockfile, claudeDir, deps);

  // JSON output
  if (args.flags.json) {
    return ok(JSON.stringify(entries, null, 2));
  }

  // Table output
  return ok(formatTable(entries));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildEntries(
  lockfile: Lockfile,
  claudeDir: string,
  deps: CliDeps,
): ListEntry[] {
  return lockfile.hooks.map((hook) => ({
    name: hook.name,
    group: hook.group,
    event: hook.event,
    outputMode: lockfile.outputMode,
    status: checkStatus(hook, claudeDir, deps),
  }));
}

function checkStatus(
  hook: LockfileHookEntry,
  claudeDir: string,
  deps: CliDeps,
): "ok" | "MISSING" {
  for (const file of hook.files) {
    const fullPath = `${claudeDir}/${file}`;
    if (!deps.fileExists(fullPath)) {
      return "MISSING";
    }
  }
  return "ok";
}

function formatTable(entries: ListEntry[]): string {
  const header = padRow("Name", "Group", "Event", "Output Mode", "Status");
  const separator = padRow("────", "─────", "─────", "───────────", "──────");
  const rows = entries.map((e) =>
    padRow(e.name, e.group, e.event, e.outputMode, e.status),
  );

  const lines = [header, separator, ...rows];

  // Add hint if any orphaned hooks
  const hasMissing = entries.some((e) => e.status === "MISSING");
  if (hasMissing) {
    lines.push("");
    lines.push("Warning: Some hook files are missing. Run paih install to restore them.");
  }

  return lines.join("\n");
}

function padRow(
  name: string,
  group: string,
  event: string,
  outputMode: string,
  status: string,
): string {
  return [
    name.padEnd(24),
    group.padEnd(20),
    event.padEnd(16),
    outputMode.padEnd(14),
    status,
  ].join("  ");
}
