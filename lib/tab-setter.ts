/**
 * tab-setter.ts - Unified tab state setter.
 *
 * Single function that:
 * 1. Sets Kitty tab title and color via remote control
 * 2. Persists per-window state for daemon recovery
 *
 * All hooks call setTabState() instead of directly running kitten commands.
 */

import { join } from "node:path";
import {
  ensureDir,
  fileExists,
  readDir,
  readFile,
  readJson,
  removeFile,
  writeFile,
} from "@hooks/core/adapters/fs";
import { execSyncSafe, getEnv } from "@hooks/core/adapters/process";
import type { PaiError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import { paiPath } from "@hooks/lib/paths";
import type { AlgorithmTabPhase, TabState } from "@hooks/lib/tab-constants";
import {
  ACTIVE_TAB_BG,
  ACTIVE_TAB_FG,
  INACTIVE_TAB_FG,
  PHASE_TAB_CONFIG,
  TAB_COLORS,
} from "@hooks/lib/tab-constants";

// ── Deps ──

export interface TabSetterDeps {
  fileExists: (path: string) => boolean;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  readDir: (path: string) => Result<string[], PaiError>;
  removeFile: (path: string) => Result<void, PaiError>;
  readFile: (path: string) => Result<string, PaiError>;
  readJson: <T>(path: string) => Result<T, PaiError>;
  execSync: (
    cmd: string,
    opts?: { timeout?: number; stdio?: "pipe" | "inherit" | "ignore" },
  ) => Result<string, PaiError>;
  getEnv: (name: string) => string | undefined;
  stderr: (msg: string) => void;
}

function envLookup(name: string): string | undefined {
  const result = getEnv(name);
  return result.ok ? result.value : undefined;
}

export const defaultTabSetterDeps: TabSetterDeps = {
  fileExists,
  writeFile,
  ensureDir,
  readDir,
  removeFile,
  readFile,
  readJson,
  execSync: (cmd: string, opts?: { timeout?: number; stdio?: "pipe" | "inherit" | "ignore" }) =>
    execSyncSafe(cmd, { timeout: opts?.timeout, stdio: opts?.stdio }),
  getEnv: envLookup,
  stderr: (msg: string) => process.stderr.write(`${msg}\n`),
};

// ── Path constants ──

const TAB_TITLES_DIR = paiPath("MEMORY", "STATE", "tab-titles");
const KITTY_SESSIONS_DIR = paiPath("MEMORY", "STATE", "kitty-sessions");

// ── Kitty Env ──

interface KittyEnv {
  listenOn: string | null;
  windowId: string | null;
}

/**
 * Get Kitty environment from env vars or persisted per-session file.
 *
 * Resolution order:
 * 1. Process env vars (direct terminal context — always correct)
 * 2. Per-session file: kitty-sessions/{sessionId}.json (no shared state, no races)
 * 3. Default socket at /tmp/kitty-$USER (fallback for socket-only configs)
 *
 * IMPORTANT: listenOn MUST be set for remote control to work safely.
 * Without it, kitten @ commands fall back to escape-sequence IPC which
 * leaks garbage text into the terminal output. See PR #493.
 */
function getKittyEnv(deps: TabSetterDeps, sessionId?: string): KittyEnv {
  // Try environment first (direct terminal calls)
  let listenOn = deps.getEnv("KITTY_LISTEN_ON") || null;
  let windowId = deps.getEnv("KITTY_WINDOW_ID") || null;
  if (listenOn && windowId) return { listenOn, windowId };

  // Per-session file lookup (preferred — no shared mutable state)
  if (sessionId) {
    const sessionPath = join(KITTY_SESSIONS_DIR, `${sessionId}.json`);
    if (deps.fileExists(sessionPath)) {
      const result = deps.readJson<{ listenOn?: string; windowId?: string }>(sessionPath);
      if (result.ok) {
        listenOn = listenOn || result.value.listenOn || null;
        windowId = windowId || result.value.windowId || null;
        if (listenOn && windowId) return { listenOn, windowId };
      }
    }
  }

  // Fallback: check default socket path used by kitty's listen_on config.
  // This prevents escape-sequence IPC when KITTY_LISTEN_ON isn't propagated
  // to subprocess contexts (the root cause of terminal garbage in #493).
  if (!listenOn) {
    const user = deps.getEnv("USER") || "";
    const defaultSocket = `/tmp/kitty-${user}`;
    if (deps.fileExists(defaultSocket)) {
      listenOn = `unix:${defaultSocket}`;
    }
  }

  // Log when kitty env lookup fails with a session ID (diagnostic for compaction issues)
  if (sessionId && !listenOn && !windowId) {
    deps.stderr(
      `[tab-setter] getKittyEnv: no kitty env found for session ${sessionId.slice(0, 8)} (no env vars, no session file, no default socket)`,
    );
  }

  return { listenOn, windowId };
}

/**
 * Persist a session's Kitty environment for later hook lookups.
 * Called by StartupGreeting at session start.
 *
 * Each session gets its own file: kitty-sessions/{sessionId}.json
 * - No shared mutable state (concurrent session starts are safe)
 * - No unbounded growth (files cleaned up on session end)
 * - Simple atomic write (no read-modify-write cycle)
 */
export function persistKittySession(
  sessionId: string,
  listenOn: string,
  windowId: string,
  deps: TabSetterDeps = defaultTabSetterDeps,
): void {
  if (!deps.fileExists(KITTY_SESSIONS_DIR)) deps.ensureDir(KITTY_SESSIONS_DIR);
  deps.writeFile(
    join(KITTY_SESSIONS_DIR, `${sessionId}.json`),
    JSON.stringify({ listenOn, windowId }),
  );
}

/**
 * Remove a session's persisted Kitty environment file.
 * Called by SessionSummary at session end.
 */
export function cleanupKittySession(
  sessionId: string,
  deps: TabSetterDeps = defaultTabSetterDeps,
): void {
  const sessionPath = join(KITTY_SESSIONS_DIR, `${sessionId}.json`);
  if (deps.fileExists(sessionPath)) deps.removeFile(sessionPath);
}

interface SetTabOptions {
  title: string;
  state: TabState;
  previousTitle?: string;
  sessionId?: string;
}

/**
 * Clean up state files for kitty windows that no longer exist.
 * Runs opportunistically on each setTabState call (lightweight).
 */
function cleanupStaleStateFiles(deps: TabSetterDeps): void {
  if (!deps.fileExists(TAB_TITLES_DIR)) return;
  const dirResult = deps.readDir(TAB_TITLES_DIR);
  if (!dirResult.ok) return;
  const files = dirResult.value.filter((f: string) => f.endsWith(".json"));
  if (files.length === 0) return;

  // Get live window IDs from kitty via socket (prevents escape sequence leaks)
  const user = deps.getEnv("USER") || "";
  const defaultSocket = `/tmp/kitty-${user}`;
  const socketPath =
    deps.getEnv("KITTY_LISTEN_ON") ||
    (deps.fileExists(defaultSocket) ? `unix:${defaultSocket}` : null);
  if (!socketPath) return; // No socket — skip cleanup to avoid escape sequence IPC

  const liveResult = deps.execSync(
    `kitten @ --to="${socketPath}" ls 2>/dev/null | jq -r ".[].tabs[].windows[].id" 2>/dev/null`,
    { timeout: 2000 },
  );
  if (!liveResult.ok) return;
  const liveOutput = liveResult.value.trim();
  if (!liveOutput) return;

  const liveIds = new Set(liveOutput.split("\n").map((id: string) => id.trim()));

  for (const file of files) {
    const winId = file.replace(".json", "");
    if (!liveIds.has(winId)) {
      deps.removeFile(join(TAB_TITLES_DIR, file));
    }
  }
}

export function setTabState(opts: SetTabOptions, deps: TabSetterDeps = defaultTabSetterDeps): void {
  const { title, state, previousTitle, sessionId } = opts;
  const colors = TAB_COLORS[state];
  const kittyEnv = getKittyEnv(deps, sessionId);

  // Need either TERM=xterm-kitty OR a valid KITTY_LISTEN_ON to proceed
  const isKitty = deps.getEnv("TERM") === "xterm-kitty" || kittyEnv.listenOn;
  if (!isKitty) return;

  // CRITICAL: Always use --to flag for socket-based remote control.
  // Without it, kitten @ falls back to escape-sequence IPC which leaks
  // garbage text (e.g. "P@kitty-cmd{...}") into terminal output when
  // running in subprocess contexts. See PR #493.
  if (!kittyEnv.listenOn) {
    deps.stderr(
      "[tab-setter] No kitty socket available, skipping tab update to prevent escape sequence leaks",
    );
    return;
  }

  const escaped = title.replace(/"/g, '\\"');
  // Set BOTH tab title AND window title. Kitty's tab_title_template uses
  // {active_window.title} (the window title). OSC escape codes from Claude Code
  // reset set-tab-title overrides, so the template falls back to window title.
  // By setting both, our title survives OSC resets.
  const toFlag = `--to="${kittyEnv.listenOn}"`;
  deps.stderr(`[tab-setter] Setting tab: "${escaped}" with toFlag: ${toFlag}`);
  deps.execSync(`kitten @ ${toFlag} set-tab-title "${escaped}"`, {
    timeout: 2000,
    stdio: "ignore",
  });
  deps.execSync(`kitten @ ${toFlag} set-window-title "${escaped}"`, {
    timeout: 2000,
    stdio: "ignore",
  });

  // For idle state, reset ALL colors to Kitty defaults (no lingering backgrounds)
  if (state === "idle") {
    deps.execSync(
      `kitten @ ${toFlag} set-tab-color --self active_bg=none active_fg=none inactive_bg=none inactive_fg=none`,
      { timeout: 2000, stdio: "ignore" },
    );
  } else {
    deps.execSync(
      `kitten @ ${toFlag} set-tab-color --self active_bg=${ACTIVE_TAB_BG} active_fg=${ACTIVE_TAB_FG} inactive_bg=${colors.inactiveBg} inactive_fg=${INACTIVE_TAB_FG}`,
      { timeout: 2000, stdio: "ignore" },
    );
  }
  deps.stderr("[tab-setter] Tab commands completed successfully");

  // Persist per-window state (or clean up on idle/session end)
  const windowId = kittyEnv.windowId;
  if (!windowId) return;

  if (state === "idle") {
    // Session ended — remove state file so no stale data lingers
    const statePath = join(TAB_TITLES_DIR, `${windowId}.json`);
    if (deps.fileExists(statePath)) deps.removeFile(statePath);
  } else {
    if (!deps.fileExists(TAB_TITLES_DIR)) deps.ensureDir(TAB_TITLES_DIR);
    const stateData: Record<string, string | boolean | number> = {
      title,
      inactiveBg: colors.inactiveBg,
      state,
      timestamp: new Date().toISOString(),
    };
    if (previousTitle) stateData.previousTitle = previousTitle;
    deps.writeFile(join(TAB_TITLES_DIR, `${windowId}.json`), JSON.stringify(stateData));
  }

  // Opportunistic cleanup of stale state files for dead windows
  cleanupStaleStateFiles(deps);
}

interface TabStateData {
  title?: string;
  state?: string;
  previousTitle?: string;
  phase?: string;
}

/**
 * Read per-window state file. Returns null if not found or invalid.
 */
export function readTabState(
  sessionId?: string,
  deps: TabSetterDeps = defaultTabSetterDeps,
): { title: string; state: TabState; previousTitle?: string; phase?: string } | null {
  const kittyEnv = getKittyEnv(deps, sessionId);
  const windowId = kittyEnv.windowId;
  if (!windowId) return null;
  const statePath = join(TAB_TITLES_DIR, `${windowId}.json`);
  if (!deps.fileExists(statePath)) return null;
  const result = deps.readJson<TabStateData>(statePath);
  if (!result.ok) return null;
  const raw = result.value;
  return {
    title: raw.title || "",
    state: (raw.state || "idle") as TabState,
    previousTitle: raw.previousTitle,
    phase: raw.phase,
  };
}

/**
 * Strip emoji prefix from a tab title to get raw text.
 * Handles both working-state prefixes and Algorithm phase symbols.
 */
export function stripPrefix(title: string): string {
  return title
    .replace(
      /^(?:🧠|⚙️|⚙|✓|❓|👁️|📋|🔨|⚡|✅|📚)\s*/u,
      "",
    )
    .trim();
}

// Noise words to skip when extracting the session label
const SESSION_NOISE = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "to",
  "in",
  "on",
  "of",
  "with",
  "my",
  "our",
  "new",
  "old",
  "fix",
  "add",
  "update",
  "set",
  "get",
]);

/**
 * Extract two representative words from a session name.
 * "Tab Title Upgrade" -> "TAB TITLE", "Security Redesign" -> "SECURITY REDESIGN"
 * "Fix Activity Dashboard" -> "ACTIVITY DASHBOARD"
 * Returns uppercase. Falls back to first two words if all are noise.
 */
export function getSessionOneWord(
  sessionId: string,
  deps: TabSetterDeps = defaultTabSetterDeps,
): string | null {
  const namesPath = paiPath("MEMORY", "STATE", "session-names.json");
  if (!deps.fileExists(namesPath)) return null;
  const result = deps.readJson<Record<string, string>>(namesPath);
  if (!result.ok) return null;
  const fullName = result.value[sessionId];
  if (!fullName) return null;

  const words = fullName.split(/\s+/).filter((w: string) => w.length > 0);
  if (words.length === 0) return null;

  // Collect up to 2 non-noise words
  const meaningful = words.filter((w: string) => !SESSION_NOISE.has(w.toLowerCase()));
  if (meaningful.length >= 2) {
    return `${meaningful[0]} ${meaningful[1]}`.toUpperCase();
  } else if (meaningful.length === 1) {
    // One meaningful word — grab the next word (even if noise) for context
    const idx = words.indexOf(meaningful[0]);
    const next = words[idx + 1];
    if (next) return `${meaningful[0]} ${next}`.toUpperCase();
    return meaningful[0].toUpperCase();
  }
  // All noise — take first two
  return words.slice(0, 2).join(" ").toUpperCase();
}

/**
 * Set tab title and color for an Algorithm phase.
 * Active format:    {SYMBOL} {ONE_WORD} | {PHASE}
 * Complete format:  {ONE_WORD} | {summary}
 *
 * Called by AlgorithmTracker on phase transitions.
 */
export function setPhaseTab(
  phase: AlgorithmTabPhase,
  sessionId: string,
  summary?: string,
  deps: TabSetterDeps = defaultTabSetterDeps,
): void {
  const config = PHASE_TAB_CONFIG[phase];
  if (!config) return;

  const oneWord = getSessionOneWord(sessionId, deps) || "WORKING";
  const kittyEnv = getKittyEnv(deps, sessionId);

  // Build title based on phase
  let title: string;
  if (phase === "COMPLETE" && summary) {
    title = `✅ ${summary}`;
  } else if (phase === "COMPLETE") {
    // No summary extracted — use session name instead of generic "Done."
    title = `✅ ${oneWord}`;
  } else if (phase === "IDLE") {
    title = oneWord;
  } else {
    // Preserve existing working description from UpdateTabTitle if available.
    // Only swap the emoji prefix to show current phase — keep the real task context.
    let existingDesc = "";
    const currentState = readTabState(sessionId, deps);
    if (currentState?.title) {
      const pipeIdx = currentState.title.indexOf("|");
      if (pipeIdx !== -1) existingDesc = currentState.title.slice(pipeIdx + 1).trim();
    }
    const desc = existingDesc || config.gerund;
    title = `${config.symbol} ${oneWord} | ${desc}`;
  }

  const isKitty = deps.getEnv("TERM") === "xterm-kitty" || kittyEnv.listenOn;
  if (!isKitty) return;

  // CRITICAL: Require socket for remote control. See PR #493.
  if (!kittyEnv.listenOn) {
    deps.stderr("[tab-setter] No kitty socket available, skipping phase tab update");
    return;
  }

  const escaped = title.replace(/"/g, '\\"');
  const toFlag = `--to="${kittyEnv.listenOn}"`;

  deps.execSync(`kitten @ ${toFlag} set-tab-title "${escaped}"`, {
    timeout: 2000,
    stdio: "ignore",
  });
  deps.execSync(`kitten @ ${toFlag} set-window-title "${escaped}"`, {
    timeout: 2000,
    stdio: "ignore",
  });

  if (phase === "IDLE") {
    deps.execSync(
      `kitten @ ${toFlag} set-tab-color --self active_bg=none active_fg=none inactive_bg=none inactive_fg=none`,
      { timeout: 2000, stdio: "ignore" },
    );
  } else {
    deps.execSync(
      `kitten @ ${toFlag} set-tab-color --self active_bg=${ACTIVE_TAB_BG} active_fg=${ACTIVE_TAB_FG} inactive_bg=${config.inactiveBg} inactive_fg=${INACTIVE_TAB_FG}`,
      { timeout: 2000, stdio: "ignore" },
    );
  }
  deps.stderr(`[tab-setter] Phase tab: "${escaped}" (${phase}, bg=${config.inactiveBg})`);

  // Persist per-window state
  const windowId = kittyEnv.windowId;
  if (!windowId) return;

  if (!deps.fileExists(TAB_TITLES_DIR)) deps.ensureDir(TAB_TITLES_DIR);
  deps.writeFile(
    join(TAB_TITLES_DIR, `${windowId}.json`),
    JSON.stringify({
      title,
      inactiveBg: config.inactiveBg,
      state: phase === "COMPLETE" ? "completed" : "working",
      phase,
      timestamp: new Date().toISOString(),
    }),
  );
}
