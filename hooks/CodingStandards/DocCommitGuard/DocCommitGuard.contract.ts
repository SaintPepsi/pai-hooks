/**
 * DocCommitGuard Contract — Block git commit when hooks are missing doc.md or IDEA.md.
 *
 * PreToolUse hook that fires on Bash commands containing `git commit`.
 * Scans all hooks/{Group}/{Hook}/hook.json directories and verifies
 * each has both doc.md and IDEA.md. Blocks with a list of missing files.
 */

import { basename, dirname, join, resolve } from "node:path";
import { fileExists as adapterFileExists } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { BlockOutput, ContinueOutput } from "@hooks/core/types/hook-outputs";
import { continueOk } from "@hooks/core/types/hook-outputs";
import { defaultStderr } from "@hooks/lib/paths";
import { getCommand } from "@hooks/lib/tool-input";
import { Glob } from "bun";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DocCommitGuardDeps {
  stderr: (msg: string) => void;
  fileExists: (path: string) => boolean;
  scanHookJsons: (hooksDir: string) => Iterable<string>;
  hooksDir: string;
}

interface MissingDoc {
  hookName: string;
  groupName: string;
  file: "doc.md" | "IDEA.md";
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Matches `git commit` with word boundaries, works in chained commands. */
const GIT_COMMIT_RE = /\bgit\s+commit\b/;

// ─── Pure Functions ──────────────────────────────────────────────────────────

/** Scan hook directories and return list of missing doc files. */
export function findMissingDocs(deps: DocCommitGuardDeps): MissingDoc[] {
  const missing: MissingDoc[] = [];

  for (const match of deps.scanHookJsons(deps.hooksDir)) {
    const hookJsonPath = join(deps.hooksDir, match);
    const hookDir = dirname(hookJsonPath);
    const hookName = basename(hookDir);
    const groupName = basename(dirname(hookDir));

    if (!deps.fileExists(join(hookDir, "doc.md"))) {
      missing.push({ hookName, groupName, file: "doc.md" });
    }

    if (!deps.fileExists(join(hookDir, "IDEA.md"))) {
      missing.push({ hookName, groupName, file: "IDEA.md" });
    }
  }

  return missing;
}

/** Format missing docs into a block reason string. */
export function formatBlockReason(missing: MissingDoc[]): string {
  const lines: string[] = ["Commit blocked: hook documentation incomplete.", ""];

  for (const m of missing) {
    lines.push(`  - ${m.groupName}/${m.hookName}: missing ${m.file}`);
  }

  lines.push("");
  lines.push("Add the missing files before committing.");

  return lines.join("\n");
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: DocCommitGuardDeps = {
  stderr: defaultStderr,
  fileExists: adapterFileExists,
  scanHookJsons: (hooksDir: string) => {
    const glob = new Glob("*/*/hook.json");
    return glob.scanSync({ cwd: hooksDir });
  },
  hooksDir: resolve(import.meta.dir, "../../.."),
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const DocCommitGuard: SyncHookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  DocCommitGuardDeps
> = {
  name: "DocCommitGuard",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name !== "Bash") return false;
    return GIT_COMMIT_RE.test(getCommand(input));
  },

  execute(
    _input: ToolHookInput,
    deps: DocCommitGuardDeps,
  ): Result<ContinueOutput | BlockOutput, ResultError> {
    const missing = findMissingDocs(deps);

    if (missing.length === 0) {
      return ok(continueOk());
    }

    const reason = formatBlockReason(missing);
    deps.stderr(reason);

    return ok({
      type: "block",
      decision: "block",
      reason,
    });
  },

  defaultDeps,
};
