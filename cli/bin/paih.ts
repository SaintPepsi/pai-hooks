/**
 * paih — CLI entry point for the PAI hook installer.
 *
 * Reads argv, routes to subcommands, and maps Result to exit codes:
 *   0 = success (Ok)
 *   1 = user error (PaihError with user-facing code)
 *   2 = internal error (unexpected failure)
 */

import { parseArgs } from "@hooks/cli/core/args";
import { PaihErrorCode } from "@hooks/cli/core/error";
import type { PaihError } from "@hooks/cli/core/error";
import type { Result } from "@hooks/cli/core/result";
import { install } from "@hooks/cli/commands/install";
import { uninstall } from "@hooks/cli/commands/uninstall";
import { update } from "@hooks/cli/commands/update";
import { verify } from "@hooks/cli/commands/verify";
import { makeDefaultDeps } from "@hooks/cli/types/default-deps";

// ─── Version ────────────────────────────────────────────────────────────────

const VERSION = "0.1.0";

// ─── Usage ──────────────────────────────────────────────────────────────────

const USAGE = `paih — PAI hook installer

Usage:
  paih <command> [names...] [flags]

Commands:
  install     Install hooks to target project
  uninstall   Remove hooks from target project
  update      Re-install hooks whose source changed
  verify      Validate hooks (source or installed)
  list        List available hooks, groups, and presets
  status      Show installed hook status
  validate    Validate hook manifests

Flags:
  --help        Show this help message
  --version     Show version
  --to <dir>    Target project directory
  --from <dir>  Source hooks directory
  --in <dir>    Working directory override
  --force       Overwrite existing hooks
  --dry-run     Preview changes without writing
  --json        Output as JSON
  --fix         Auto-fix derivable manifest fields (verify)
  --installed   Verify installed hooks (verify)
`;

// ─── Known Commands ─────────────────────────────────────────────────────────

const KNOWN_COMMANDS = new Set([
  "install",
  "uninstall",
  "update",
  "verify",
  "list",
  "status",
  "validate",
]);

// ─── Exit Code Mapping ──────────────────────────────────────────────────────

/** User-facing error codes that map to exit code 1 (user error). */
const USER_ERROR_CODES = new Set<string>([
  PaihErrorCode.TargetNotFound,
  PaihErrorCode.HookNotFound,
  PaihErrorCode.ManifestMissing,
  PaihErrorCode.ManifestParseError,
  PaihErrorCode.ManifestSchemaInvalid,
  PaihErrorCode.InvalidArgs,
  PaihErrorCode.SettingsConflict,
  PaihErrorCode.DepCycle,
  PaihErrorCode.LockMissing,
  PaihErrorCode.FileModified,
]);

function exitCodeFromError(error: PaihError): number {
  return USER_ERROR_CODES.has(error.code) ? 1 : 2;
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function main(argv: string[]): { exitCode: number; output: string; stream: "stdout" | "stderr" } {
  const parsed = parseArgs(argv);

  if (!parsed.ok) {
    return { exitCode: 1, output: parsed.error.message, stream: "stderr" };
  }

  const { command, flags } = parsed.value;

  // --help flag (anywhere)
  if (flags.help) {
    return { exitCode: 0, output: USAGE, stream: "stdout" };
  }

  // --version flag (anywhere)
  if (flags.version) {
    return { exitCode: 0, output: `paih v${VERSION}`, stream: "stdout" };
  }

  // No command
  if (!command) {
    return { exitCode: 1, output: USAGE, stream: "stderr" };
  }

  // Unknown command
  if (!KNOWN_COMMANDS.has(command)) {
    return { exitCode: 1, output: `Unknown command: ${command}`, stream: "stderr" };
  }

  // Route to subcommand (stubs for now — will be implemented in future issues)
  const result = routeCommand(command, parsed.value);
  if (!result.ok) {
    return {
      exitCode: exitCodeFromError(result.error),
      output: result.error.message,
      stream: "stderr",
    };
  }

  return { exitCode: 0, output: result.value, stream: "stdout" };
}

// ─── Command Routing ────────────────────────────────────────────────────────

function routeCommand(
  command: string,
  args: { command: string; names: string[]; flags: Record<string, boolean | string> },
): Result<string, PaihError> {
  const deps = makeDefaultDeps();
  switch (command) {
    case "install":
      return install(args, deps);
    case "uninstall":
      return uninstall(args, deps);
    case "update":
      return update(args, deps);
    case "verify":
      return verify(args, deps);
    case "list":
    case "status":
    case "validate":
      return { ok: true, value: `${command}: not yet implemented` };
    default:
      return { ok: true, value: "" };
  }
}

// ─── CLI Runner ─────────────────────────────────────────────────────────────

/** Run when executed directly. */
if (import.meta.main) {
  const result = main(process.argv.slice(2));
  const writer = result.stream === "stdout" ? process.stdout : process.stderr;
  writer.write(result.output + "\n");
  process.exit(result.exitCode);
}
