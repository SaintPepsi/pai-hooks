/**
 * Lockfile types — tracks installed hooks for idempotency and status.
 *
 * Written to .claude/hooks/paih.lock.json after successful install.
 */

// ─── Output Mode ─────────────────────────────────────────────────────────────

/**
 * Output mode for installed hooks.
 *
 * - "source":      raw .ts files, run via bun (default)
 * - "compiled":    bundled .js via bun build --target=node, shebang #!/usr/bin/env node
 * - "compiled-ts": bundled .ts via bun build --bundle, shebang #!/usr/bin/env bun
 */
export type OutputMode = "source" | "compiled" | "compiled-ts";

/** Default output mode for lockfiles that omit the field. */
export const DEFAULT_OUTPUT_MODE: OutputMode = "source";

// ─── Lockfile Schema ─────────────────────────────────────────────────────────

export interface LockfileHookEntry {
  /** Hook name matching the manifest. */
  name: string;
  /** Group this hook belongs to. */
  group: string;
  /** Hook event type. */
  event: string;
  /** The command string written to settings.json. */
  commandString: string;
  /** Relative file paths (from .claude/) that were installed. */
  files: string[];
  /** SHA-256 hash of source files at install time. */
  sourceHash?: string;
}

export interface Lockfile {
  /** Schema version for forward compatibility. */
  lockfileVersion: 1;
  /** Source repository URL or local path. */
  source: string;
  /** Git commit hash of source at install time, or null for local. */
  sourceCommit: string | null;
  /** ISO8601 timestamp of install. */
  installedAt: string;
  /** Output mode used for install. Defaults to "source" for old lockfiles. */
  outputMode: OutputMode;
  /** Installed hooks. */
  hooks: LockfileHookEntry[];
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createLockfile(
  source: string,
  sourceCommit: string | null,
  outputMode: OutputMode = DEFAULT_OUTPUT_MODE,
): Lockfile {
  return {
    lockfileVersion: 1,
    source,
    sourceCommit,
    installedAt: new Date().toISOString(),
    outputMode,
    hooks: [],
  };
}
