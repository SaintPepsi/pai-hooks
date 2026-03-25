/**
 * CLI Argument Parser — Parses argv into structured ParsedArgs.
 *
 * Handles:
 *   - Command extraction (first positional arg)
 *   - Multi-name support: "paih install A B C" → names: ["A", "B", "C"]
 *   - Known flags: --help, --version, --to, --from, --in, --force, --dry-run, --json
 *   - Unknown flags → Err(INVALID_ARGS)
 */

import type { Result } from "@hooks/cli/core/result";
import { ok, err } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { invalidArgs } from "@hooks/cli/core/error";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedArgs {
  command: string;
  names: string[];
  flags: Record<string, boolean | string>;
}

// ─── Known Flags ────────────────────────────────────────────────────────────

/** Flags that take no value (boolean). */
const BOOLEAN_FLAGS = new Set([
  "--help",
  "--version",
  "--force",
  "--dry-run",
  "--json",
  "--groups",
  "--presets",
]);

/** Flags that take a string value. */
const VALUE_FLAGS = new Set(["--to", "--from", "--in"]);

const ALL_FLAGS = new Set([...BOOLEAN_FLAGS, ...VALUE_FLAGS]);

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse raw argv (without the first two entries: bun + script path).
 * Typically pass `process.argv.slice(2)`.
 */
export function parseArgs(argv: string[]): Result<ParsedArgs, PaihError> {
  const flags: Record<string, boolean | string> = {};
  const positional: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith("--")) {
      if (!ALL_FLAGS.has(arg)) {
        return err(invalidArgs(`Unknown flag: ${arg}`));
      }

      if (BOOLEAN_FLAGS.has(arg)) {
        // Strip leading -- and convert to camelCase
        flags[flagKey(arg)] = true;
      } else {
        // Value flag — next arg is the value
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          return err(invalidArgs(`Flag ${arg} requires a value`));
        }
        flags[flagKey(arg)] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
    i++;
  }

  const command = positional[0] ?? "";
  const names = positional.slice(1);

  return ok({ command, names, flags });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert --dry-run to dryRun, --force to force, etc. */
function flagKey(flag: string): string {
  return flag
    .replace(/^--/, "")
    .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
