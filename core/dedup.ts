/**
 * Hook Deduplication Guard — Prevents the same hook from firing twice
 * when registered at both global and project config levels.
 *
 * Uses atomic file creation (O_EXCL via writeFileExclusive) so concurrent
 * processes race safely: first writer wins, second sees EEXIST and skips.
 */

import { join } from "node:path";
import { ensureDir, writeFileExclusive } from "@hooks/core/adapters/fs";
import type { HookInput } from "@hooks/core/types/hook-inputs";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Values the JSON.stringify replacer receives. */
type JsonReplacerValue =
  | string
  | number
  | boolean
  | null
  | JsonReplacerValue[]
  | { [key: string]: JsonReplacerValue };

export interface DedupDeps {
  ensureDir: (path: string) => boolean;
  tryClaimLock: (path: string) => boolean;
}

// ─── Default Deps ───────────────────────────────────────────────────────────

export const defaultDedupDeps = (): DedupDeps => ({
  ensureDir: (path: string) => {
    return ensureDir(path).ok;
  },
  tryClaimLock: (path: string) => {
    return writeFileExclusive(path, String(process.pid)).ok;
  },
});

// ─── Stable Hash ────────────────────────────────────────────────────────────

/**
 * Serialize with sorted keys so {a:1,b:2} and {b:2,a:1} produce the same string.
 * Uses JSON.stringify's replacer to sort object keys at every nesting level.
 */
function stableStringify(hookName: string, input: HookInput): string {
  return JSON.stringify({ hook: hookName, input }, (_key, value: JsonReplacerValue) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const sorted: Record<string, JsonReplacerValue> = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = (value as Record<string, JsonReplacerValue>)[k];
      }
      return sorted;
    }
    return value;
  });
}

export function stableHash(hookName: string, input: HookInput): string {
  const payload = stableStringify(hookName, input);
  return Bun.hash(payload).toString(16).slice(0, 16);
}

// ─── Dedup Guard ────────────────────────────────────────────────────────────

const DEDUP_DIR = "/tmp/pai-dedup";

/**
 * Check if this hook has already fired for this input in this session.
 *
 * Returns true if this is a DUPLICATE (should skip).
 * Returns false if this is the FIRST invocation (should proceed).
 *
 * Fails open: any error returns false (not duplicate), so hooks
 * always fire rather than silently dropping.
 */
export function isDuplicate(
  hookName: string,
  sessionId: string,
  input: HookInput,
  deps: DedupDeps = defaultDedupDeps(),
): boolean {
  const sessionDir = join(DEDUP_DIR, sessionId);
  const hash = stableHash(hookName, input);
  const lockPath = join(sessionDir, `${hookName}-${hash}.lock`);

  if (!deps.ensureDir(sessionDir)) return false;
  const claimed = deps.tryClaimLock(lockPath);
  return !claimed;
}
