/**
 * StartupGreeting Contract — Display PAI banner at session start.
 *
 * Runs Banner.ts tool, persists Kitty session environment.
 * Skips for subagents.
 */

import { join } from "node:path";
import { ensureDir, fileExists, readJson, writeFile } from "@hooks/core/adapters/fs";
import { spawnSyncSafe } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { getPaiDir } from "@hooks/lib/paths";
import { isSubagent } from "@hooks/lib/environment";
import type { ContextOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import { persistKittySession } from "@hooks/lib/tab-setter";

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

const defaultDeps: StartupGreetingDeps = {
  readSettings: () => {
    const paiDir = getPaiDir();
    const settingsPath = join(paiDir, "settings.json");
    return readJson<Record<string, unknown>>(settingsPath);
  },
  runBanner: () => {
    const paiDir = getPaiDir();
    const bannerPath = join(paiDir, "PAI/Tools/Banner.ts");
    const result = spawnSyncSafe("bun", ["run", bannerPath], {
      encoding: "utf-8",
      stdio: "pipe",
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
  isSubagent: () => isSubagent((k) => process.env[k]),
  getEnv: (key) => process.env[key],
  fileExists,
  ensureDir,
  writeFile,
  paiDir: getPaiDir(),
  stderr: (msg) => process.stderr.write(`${msg}\n`),
};

export const StartupGreeting: SyncHookContract<
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
          JSON.stringify(
            { KITTY_LISTEN_ON: kittyListenOn, KITTY_WINDOW_ID: kittyWindowId },
            null,
            2,
          ),
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
