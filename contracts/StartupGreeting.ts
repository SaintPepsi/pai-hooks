/**
 * StartupGreeting Contract — Display PAI banner at session start.
 *
 * Runs Banner.ts tool, persists Kitty session environment.
 * Skips for subagents.
 */

import type { HookContract } from "../core/contract";
import type { SessionStartInput } from "../core/types/hook-inputs";
import type { ContextOutput, SilentOutput } from "../core/types/hook-outputs";
import { ok, type Result } from "../core/result";
import type { PaiError } from "../core/error";
import { fileExists, readJson, writeFile, ensureDir } from "../core/adapters/fs";
import { spawnSyncSafe } from "../core/adapters/process";
import { join } from "path";
import { persistKittySession } from "../lib/tab-setter";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StartupGreetingDeps {
  readSettings: () => Result<Record<string, unknown>, PaiError>;
  runBanner: () => string | null;
  persistKittySession: typeof persistKittySession;
  isSubagent: () => boolean;
  getEnv: (key: string) => string | undefined;
  fileExists: (path: string) => boolean;
  ensureDir: (path: string) => Result<void, PaiError>;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  paiDir: string;
  stderr: (msg: string) => void;
}

// ─── Contract ────────────────────────────────────────────────────────────────

function getPaiDir(): string {
  return process.env.PAI_DIR || join(process.env.HOME!, ".claude");
}

const defaultDeps: StartupGreetingDeps = {
  readSettings: () => {
    const settingsPath = join(getPaiDir(), "settings.json");
    return readJson<Record<string, unknown>>(settingsPath);
  },
  runBanner: () => {
    const bannerPath = join(getPaiDir(), "PAI/Tools/Banner.ts");
    const result = spawnSyncSafe("bun", ["run", bannerPath], {
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        COLUMNS: process.env.COLUMNS,
        KITTY_WINDOW_ID: process.env.KITTY_WINDOW_ID,
      },
    });
    if (!result.ok) return null;
    return result.value.stdout || null;
  },
  persistKittySession,
  isSubagent: () => {
    const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR || "";
    return (
      claudeProjectDir.includes("/.claude/Agents/") ||
      process.env.CLAUDE_AGENT_TYPE !== undefined
    );
  },
  getEnv: (key) => process.env[key],
  fileExists,
  ensureDir,
  writeFile,
  paiDir: getPaiDir(),
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const StartupGreeting: HookContract<
  SessionStartInput,
  ContextOutput | SilentOutput,
  StartupGreetingDeps
> = {
  name: "StartupGreeting",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  execute(
    input: SessionStartInput,
    deps: StartupGreetingDeps,
  ): Result<ContextOutput | SilentOutput, PaiError> {
    if (deps.isSubagent()) {
      return ok({ type: "silent" });
    }

    // Persist Kitty environment for hooks that run later
    const kittyListenOn = deps.getEnv("KITTY_LISTEN_ON");
    const kittyWindowId = deps.getEnv("KITTY_WINDOW_ID");
    if (kittyListenOn && kittyWindowId) {
      if (input.session_id) {
        deps.persistKittySession(input.session_id, kittyListenOn, kittyWindowId);
      } else {
        const stateDir = join(deps.paiDir, "MEMORY", "STATE");
        deps.ensureDir(stateDir);
        deps.writeFile(
          join(stateDir, "kitty-env.json"),
          JSON.stringify({ KITTY_LISTEN_ON: kittyListenOn, KITTY_WINDOW_ID: kittyWindowId }, null, 2),
        );
      }
    }

    const bannerOutput = deps.runBanner();
    if (bannerOutput) {
      return ok({ type: "context", content: bannerOutput });
    }

    return ok({ type: "silent" });
  },

  defaultDeps,
};
