/**
 * CheckAlgorithmVersion Contract — Check for PAI Algorithm updates at session start.
 *
 * Compares local Algorithm version (LATEST file) against upstream GitHub.
 * Writes state file for Banner.ts to read. Skips for subagents.
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { ensureDir, readFile, writeFile } from "@hooks/core/adapters/fs";
import type { AsyncHookContract } from "@hooks/core/contract";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok, type Result } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { isSubagentDefault } from "@hooks/lib/environment";
import { defaultStderr, getHomeDir } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CheckAlgorithmVersionDeps {
  getLocalVersion: () => string;
  getUpstreamVersion: () => Promise<Result<string, ResultError>>;
  writeStateFile: (data: Record<string, unknown>) => void;
  isSubagent: () => boolean;
  stderr: (msg: string) => void;
  homeDir: string;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

const UPSTREAM_REPO = "danielmiessler/Personal_AI_Infrastructure";
const UPSTREAM_PATH = "Releases/v4.0.3/.claude/PAI/Algorithm/LATEST";

export function isNewer(upstream: string, local: string): boolean {
  const parse = (v: string) => {
    const match = v.match(/v?(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return { major: +match[1], minor: +match[2], patch: +match[3] };
  };

  const u = parse(upstream);
  const l = parse(local);
  if (!u || !l) return false;

  if (u.major !== l.major) return u.major > l.major;
  if (u.minor !== l.minor) return u.minor > l.minor;
  return u.patch > l.patch;
}

function defaultGetLocalVersion(homeDir: string): string {
  const latestFile = join(homeDir, ".claude/PAI/Algorithm/LATEST");
  const result = readFile(latestFile);
  return result.ok ? result.value.trim() : "unknown";
}

async function defaultGetUpstreamVersion(): Promise<Result<string, ResultError>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  const proc = Bun.spawn(
    ["gh", "api", `repos/${UPSTREAM_REPO}/contents/${UPSTREAM_PATH}`, "--jq", ".content"],
    { stdout: "pipe", stderr: "pipe", signal: controller.signal },
  );

  const output = await new Response(proc.stdout).text();
  clearTimeout(timeout);

  const trimmed = output.trim();
  const isValidBase64 = trimmed.length > 0 && /^[A-Za-z0-9+/\n=]+$/.test(trimmed);
  if (!isValidBase64) {
    return err(new ResultError(ErrorCode.FetchFailed, "GitHub API returned non-base64 response"));
  }

  const decoded = atob(trimmed);
  return ok(decoded.trim());
}

function defaultWriteStateFile(homeDir: string, data: Record<string, unknown>): void {
  const stateDir = join(homeDir, ".claude/MEMORY/STATE");
  ensureDir(stateDir);
  writeFile(join(stateDir, "algorithm-update.json"), JSON.stringify(data));
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: CheckAlgorithmVersionDeps = {
  getLocalVersion: () => defaultGetLocalVersion(getHomeDir()),
  getUpstreamVersion: defaultGetUpstreamVersion,
  writeStateFile: (data) => defaultWriteStateFile(getHomeDir(), data),
  isSubagent: isSubagentDefault,
  stderr: defaultStderr,
  homeDir: getHomeDir(),
};

export const CheckAlgorithmVersion: AsyncHookContract<
  SessionStartInput,
  CheckAlgorithmVersionDeps
> = {
  name: "CheckAlgorithmVersion",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  async execute(
    _input: SessionStartInput,
    deps: CheckAlgorithmVersionDeps,
  ): Promise<Result<SyncHookJSONOutput, ResultError>> {
    if (deps.isSubagent()) {
      return ok({});
    }

    const localVersion = deps.getLocalVersion();
    const upstreamResult = await deps.getUpstreamVersion();
    const upstreamVersion = upstreamResult.ok ? upstreamResult.value : "unknown";

    if (
      localVersion !== "unknown" &&
      upstreamVersion !== "unknown" &&
      isNewer(upstreamVersion, localVersion)
    ) {
      deps.writeStateFile({
        available: true,
        local: localVersion,
        upstream: upstreamVersion,
        checkedAt: new Date().toISOString(),
      });
    } else {
      deps.writeStateFile({
        available: false,
        checkedAt: new Date().toISOString(),
      });
    }

    return ok({});
  },

  defaultDeps,
};
