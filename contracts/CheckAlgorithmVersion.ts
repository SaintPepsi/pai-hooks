/**
 * CheckAlgorithmVersion Contract — Check for PAI Algorithm updates at session start.
 *
 * Compares local Algorithm version (LATEST file) against upstream GitHub.
 * Writes state file for Banner.ts to read. Skips for subagents.
 */

import type { HookContract } from "../core/contract";
import type { SessionStartInput } from "../core/types/hook-inputs";
import type { SilentOutput } from "../core/types/hook-outputs";
import { ok, type Result } from "../core/result";
import type { PaiError } from "../core/error";
import { join } from "path";
import { fileExists, readFile, writeFile, ensureDir } from "../core/adapters/fs";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CheckAlgorithmVersionDeps {
  getLocalVersion: () => string;
  getUpstreamVersion: () => Promise<string>;
  writeStateFile: (data: Record<string, unknown>) => void;
  isSubagent: () => boolean;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

const HOME = process.env.HOME!;
const ALGORITHM_DIR = join(HOME, ".claude/PAI/Components/Algorithm");
const LATEST_FILE = join(ALGORITHM_DIR, "LATEST");
const UPSTREAM_REPO = "danielmiessler/Personal_AI_Infrastructure";
const UPSTREAM_PATH = "Releases/v3.0/.claude/PAI/Components/Algorithm/LATEST";

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

function defaultGetLocalVersion(): string {
  const result = readFile(LATEST_FILE);
  return result.ok ? result.value.trim() : "unknown";
}

async function defaultGetUpstreamVersion(): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const proc = Bun.spawn(
      ["gh", "api", `repos/${UPSTREAM_REPO}/contents/${UPSTREAM_PATH}`, "--jq", ".content"],
      { stdout: "pipe", stderr: "pipe", signal: controller.signal },
    );

    const output = await new Response(proc.stdout).text();
    clearTimeout(timeout);

    const decoded = atob(output.trim());
    return decoded.trim();
  } catch {
    return "unknown";
  }
}

function defaultWriteStateFile(data: Record<string, unknown>): void {
  const stateDir = join(HOME, ".claude/MEMORY/STATE");
  ensureDir(stateDir);
  writeFile(join(stateDir, "algorithm-update.json"), JSON.stringify(data));
}

function defaultIsSubagent(): boolean {
  const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR || "";
  return (
    claudeProjectDir.includes("/.claude/Agents/") ||
    process.env.CLAUDE_AGENT_TYPE !== undefined
  );
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: CheckAlgorithmVersionDeps = {
  getLocalVersion: defaultGetLocalVersion,
  getUpstreamVersion: defaultGetUpstreamVersion,
  writeStateFile: defaultWriteStateFile,
  isSubagent: defaultIsSubagent,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const CheckAlgorithmVersion: HookContract<
  SessionStartInput,
  SilentOutput,
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
  ): Promise<Result<SilentOutput, PaiError>> {
    if (deps.isSubagent()) {
      return ok({ type: "silent" });
    }

    const localVersion = deps.getLocalVersion();
    const upstreamVersion = await deps.getUpstreamVersion();

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

    return ok({ type: "silent" });
  },

  defaultDeps,
};
