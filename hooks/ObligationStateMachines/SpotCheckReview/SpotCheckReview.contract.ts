import { join } from "node:path";
import {
  fileExists as fsFileExists,
  readFile,
  readJson,
  removeFile,
  writeFile,
} from "@hooks/core/adapters/fs";
import { execSyncSafe } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";
import type { BlockOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import { projectHasHook } from "@hooks/hooks/ObligationStateMachines/DocObligationStateMachine.shared";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpotCheckReviewDeps {
  paiDir: string;
  stateDir: string;
  getChangedFiles: () => string[];
  getFileHashes: (files: string[]) => Map<string, string>;
  fileExists: (path: string) => boolean;
  readBlockCount: (path: string) => number;
  writeBlockCount: (path: string, count: number) => void;
  readReviewedHashes: (path: string) => Record<string, string>;
  writeReviewedHashes: (path: string, hashes: Record<string, string>) => void;
  removeFlag: (path: string) => void;
  stderr: (msg: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_BLOCKS = 1;

function blockCountPath(stateDir: string, sessionId: string): string {
  return join(stateDir, `spot-check-block-${sessionId}.txt`);
}

function reviewedHashesPath(stateDir: string): string {
  return join(stateDir, "reviewed-hashes.json");
}

function getUnpushedFiles(): string[] {
  const result = execSyncSafe("git diff @{upstream}...HEAD --name-only 2>/dev/null", {
    timeout: 5000,
  });
  if (!result.ok) return [];
  return result.value.trim().split("\n").filter(Boolean);
}

function buildBlockMessage(files: string[]): string {
  const fileList = files.map((f) => `  - ${f}`).join("\n");
  return `Before ending this session, run a spot-check code review of unpushed changes using a Sonnet agent (Agent tool with model: "sonnet").

Changed files:
${fileList}

Review for: bugs, security issues, missing error handling, code quality, and adherence to project conventions in CLAUDE.md.`;
}

// ─── Default Deps ─────────────────────────────────────────────────────────────

const defaultDeps: SpotCheckReviewDeps = {
  paiDir: getPaiDir(),
  stateDir: join(
    getPaiDir(),
    "MEMORY",
    "STATE",
    "spot-check",
  ),
  getChangedFiles: getUnpushedFiles,
  getFileHashes: (files: string[]) => {
    const map = new Map<string, string>();
    for (const file of files) {
      const content = readFile(file);
      if (content.ok) {
        map.set(file, String(Bun.hash(content.value)));
      }
    }
    return map;
  },
  fileExists: (path: string) => fsFileExists(path),
  readBlockCount: (path: string) => {
    const result = readFile(path);
    if (!result.ok) return 0;
    const n = parseInt(result.value.trim(), 10);
    return Number.isNaN(n) ? 0 : n;
  },
  writeBlockCount: (path: string, count: number) => {
    writeFile(path, String(count));
  },
  readReviewedHashes: (path: string) => {
    const result = readJson<Record<string, string>>(path);
    if (!result.ok) return {};
    return result.value;
  },
  writeReviewedHashes: (path: string, hashes: Record<string, string>) => {
    writeFile(path, JSON.stringify(hashes));
  },
  removeFlag: (path: string) => {
    removeFile(path);
  },
  stderr: defaultStderr,
};

// ─── Contract ─────────────────────────────────────────────────────────────────

export const SpotCheckReview: SyncHookContract<
  StopInput,
  BlockOutput | SilentOutput,
  SpotCheckReviewDeps
> = {
  name: "SpotCheckReview",
  event: "Stop",

  accepts(_input: StopInput): boolean {
    if (projectHasHook("SpotCheckReview")) return false;
    return true;
  },

  execute(
    input: StopInput,
    deps: SpotCheckReviewDeps,
  ): Result<BlockOutput | SilentOutput, PaiError> {
    if (process.cwd() === deps.paiDir) return ok({ type: "silent" });
    const files = deps.getChangedFiles();

    if (files.length === 0) {
      return ok({ type: "silent" });
    }

    const countFile = blockCountPath(deps.stateDir, input.session_id);
    const blockCount = deps.readBlockCount(countFile);
    const hashPath = reviewedHashesPath(deps.stateDir);

    if (blockCount >= MAX_BLOCKS) {
      deps.removeFlag(countFile);
      const hashes = deps.getFileHashes(files);
      const fileSet = new Set(files);
      const existing = deps.readReviewedHashes(hashPath);
      const pruned: Record<string, string> = {};
      for (const [key, val] of Object.entries(existing)) {
        if (fileSet.has(key)) pruned[key] = val;
      }
      for (const [file, hash] of hashes) {
        pruned[file] = hash;
      }
      deps.writeReviewedHashes(hashPath, pruned);
      deps.stderr(
        `[SpotCheckReview] Block limit (${MAX_BLOCKS}) reached. Marked ${hashes.size} file(s) as reviewed. Releasing session.`,
      );
      return ok({ type: "silent" });
    }

    const reviewed = deps.readReviewedHashes(hashPath);
    const currentHashes = deps.getFileHashes(files);
    const unreviewedFiles = files.filter((f) => {
      const currentHash = currentHashes.get(f);
      if (!currentHash) return true;
      return reviewed[f] !== currentHash;
    });

    if (unreviewedFiles.length === 0) {
      deps.stderr(`[SpotCheckReview] All ${files.length} file(s) already reviewed. Skipping.`);
      return ok({ type: "silent" });
    }

    deps.writeBlockCount(countFile, blockCount + 1);
    deps.stderr(
      `[SpotCheckReview] Block ${blockCount + 1}/${MAX_BLOCKS}: ${unreviewedFiles.length} unreviewed file(s) (${files.length - unreviewedFiles.length} already reviewed)`,
    );

    return ok({ type: "block", decision: "block", reason: buildBlockMessage(unreviewedFiles) });
  },

  defaultDeps,
};
