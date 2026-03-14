/**
 * SessionAutoName Contract — Auto-generate concise session names.
 *
 * On first prompt: generates a 2-3 word session title via inference.
 * On subsequent prompts: skips (name already exists).
 * On rework (completed session + new prompt): re-generates name.
 * Custom titles from /rename are synced as authoritative.
 */

import type { HookContract } from "@hooks/core/contract";
import type { UserPromptSubmitInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { dirname, join } from "path";
import { fileExists, readFile, readJson, writeFile, ensureDir } from "@hooks/core/adapters/fs";
import { inference } from "@pai/Tools/Inference";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionNames {
  [sessionId: string]: string;
}

interface AlgorithmState {
  active?: boolean;
  currentPhase?: string;
  criteria?: unknown[];
  summary?: string;
  previousNames?: Array<{ name: string; changedAt: string }>;
  [key: string]: unknown;
}

export interface SessionAutoNameDeps {
  fileExists: (path: string) => boolean;
  readJson: <T = unknown>(path: string) => Result<T, PaiError>;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  inference: typeof inference;
  getCustomTitle: (sessionId: string, deps: SessionAutoNameDeps) => string | null;
  spawnSync: (cmd: string[], opts?: { timeout?: number }) => { stdout: { toString(): string } };
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

const NOISE_WORDS = new Set([
  "the", "a", "an", "i", "my", "we", "you", "your", "this", "that", "it",
  "is", "are", "was", "were", "do", "does", "did", "can", "could", "should",
  "would", "will", "have", "has", "had", "just", "also", "need", "want",
  "please", "session", "help", "work", "task", "update", "new", "check",
  "make", "get", "set", "put", "use", "run", "try", "let", "see", "look",
  "fix", "add", "create", "build", "deploy", "code", "read", "write",
  "thing", "things", "something", "going", "like", "know", "think", "right",
  "whatever", "current", "really", "actually", "working", "doing", "change",
  "what", "how", "why", "when", "where", "which", "who", "there", "here",
  "not", "but", "and", "for", "with", "from", "about", "into", "been",
  "some", "all", "any", "each", "every", "both", "our", "they", "them", "those", "these",
  "built", "asked", "told", "said", "went", "came", "made", "gave", "took",
  "bunch", "lots", "couple", "few", "many", "much", "more", "most", "less",
  "pretty", "very", "quite", "super", "totally", "completely", "basically",
  "okay", "yeah", "yes", "sure", "fine", "good", "bad", "great", "nice",
  "hey", "well", "now", "then", "still", "even", "already", "yet", "ago",
  "way", "kind", "sort", "type", "stuff", "part", "whole", "point",
  "one", "two", "three", "first", "last", "next", "other", "same",
  "being", "having", "getting", "making", "taking", "coming", "saying",
  "question", "answer", "figure", "out", "off", "tell", "show", "give",
  "start", "stop", "keep", "move", "turn", "pull", "push", "open", "close",
  "used", "using", "called", "mean", "means", "guess", "maybe", "probably",
]);

const NAME_PROMPT = `You are labeling a folder. Give this conversation a 2-3 word Topic Case title.

Think: "If someone saw this label on a folder, would they immediately know what's inside?"

RULES:
1. EXACTLY 2-3 real English words. Every word must be a common dictionary word (3+ letters each).
2. Must be a coherent noun phrase that a human would actually write — like a meeting topic or project name.
3. SYNTHESIZE the topic. Do NOT just grab words from the message.
4. No verbs, no articles, no sentences, no questions. Just a noun phrase.
5. Ignore all technical noise (IDs, paths, XML, hex codes). Name the SUBJECT, not the artifacts.

GOOD examples (coherent topics a human would write):
"Voice Server Fix", "Dashboard Redesign", "Algorithm Upgrade", "Session Naming", "Security Architecture", "Hook Permissions", "Feed Schema Design", "Tab Title Sync"

BAD examples (incoherent, word salad, or fragments):
"Built Bunch", "Commands R", "Didn Anything Sudden", "Notification Ede Output", "Reply Number Session", "Research Guys Shady", "Ahead Repo Started", "State Pai Installer"

WHY the bad ones are bad: they are random words strung together that don't describe a topic. A human would never label a folder that way.

Output ONLY the 2-3 word title. Nothing else.`;

export function sanitizePromptForNaming(prompt: string): string {
  return prompt
    .replace(/<[^>]+>/g, " ")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, " ")
    .replace(/\b[0-9a-f]{7,}\b/gi, " ")
    .replace(/(?:\/[\w.-]+){2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractFallbackName(prompt: string): string | null {
  const words = prompt
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !NOISE_WORDS.has(w.toLowerCase()));

  if (words.length === 0) return null;

  const topic = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
  return `${topic} Session`;
}

export function isNameRelevantToPrompt(name: string, prompt: string): boolean {
  const nameWords = name
    .split(/\s+/)
    .map((w) => w.toLowerCase().replace(/[^a-z]/g, ""))
    .filter((w) => w.length > 2 && !NOISE_WORDS.has(w));

  if (nameWords.length === 0) return true;

  const promptLower = prompt.toLowerCase();
  return nameWords.some(
    (word) =>
      promptLower.includes(word) ||
      promptLower.includes(word.slice(0, Math.max(4, Math.floor(word.length * 0.6)))),
  );
}

function defaultGetCustomTitle(sessionId: string, deps: SessionAutoNameDeps): string | null {
  const searchDirs = [
    join(deps.baseDir, "projects"),
    join(deps.baseDir, "Projects"),
  ];

  for (const projectsDir of searchDirs) {
    if (!deps.fileExists(projectsDir)) continue;

    const proc = deps.spawnSync(["grep", "-rl", sessionId, projectsDir], {
      timeout: 2000,
    });
    const indexFiles = proc.stdout.toString().trim().split("\n")
      .filter((f: string) => f.endsWith("sessions-index.json"));

    for (const indexFile of indexFiles) {
      const result = readFile(indexFile);
      if (!result.ok) continue;
      const content = result.value;
      const idPos = content.indexOf(`"sessionId": "${sessionId}"`);
      if (idPos === -1) continue;

      const chunk = content.slice(idPos, idPos + 500);
      const match = chunk.match(/"customTitle":\s*"([^"]+)"/);
      if (match) return match[1];
    }
  }
  return null;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, ".claude");

const defaultDeps: SessionAutoNameDeps = {
  fileExists,
  readJson,
  writeFile,
  ensureDir,
  inference,
  getCustomTitle: defaultGetCustomTitle,
  spawnSync: (cmd, opts) => Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", timeout: opts?.timeout }),
  baseDir: BASE_DIR,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const SessionAutoName: HookContract<
  UserPromptSubmitInput,
  SilentOutput,
  SessionAutoNameDeps
> = {
  name: "SessionAutoName",
  event: "UserPromptSubmit",

  accepts(input: UserPromptSubmitInput): boolean {
    return !!input.session_id;
  },

  async execute(
    input: UserPromptSubmitInput,
    deps: SessionAutoNameDeps,
  ): Promise<Result<SilentOutput, PaiError>> {
    const sessionId = input.session_id;
    const namesPath = join(deps.baseDir, "MEMORY", "STATE", "session-names.json");

    // Read existing names
    let names: SessionNames = {};
    const namesResult = deps.readJson<SessionNames>(namesPath);
    if (namesResult.ok) {
      names = namesResult.value;
    }

    // Check for authoritative customTitle from /rename
    const customTitle = deps.getCustomTitle(sessionId, deps);
    if (customTitle && names[sessionId] !== customTitle) {
      names[sessionId] = customTitle;
      storeName(names, namesPath, sessionId, customTitle, deps);
      deps.stderr(`[SessionAutoName] Synced customTitle: "${customTitle}"`);
      return ok({ type: "silent" });
    }

    // Sanitize prompt
    const rawPrompt = input.prompt || input.user_prompt || "";
    const prompt = sanitizePromptForNaming(rawPrompt);

    // Check for rework: session has name + algorithm state shows completed work
    let isRework = false;
    if (names[sessionId]) {
      const algoStatePath = join(deps.baseDir, "MEMORY", "STATE", "algorithms", `${sessionId}.json`);
      const algoResult = deps.readJson<AlgorithmState>(algoStatePath);
      if (!algoResult.ok) {
        return ok({ type: "silent" });
      }
      const algoState = algoResult.value;
      const isComplete = !algoState.active ||
        algoState.currentPhase === "COMPLETE" ||
        algoState.currentPhase === "LEARN" ||
        algoState.currentPhase === "IDLE";
      const hadWork = (algoState.criteria && algoState.criteria.length > 0) || !!algoState.summary;

      if (isComplete && hadWork && prompt) {
        isRework = true;
        deps.stderr(`[SessionAutoName] Rework detected — previous name: "${names[sessionId]}"`);
      } else {
        return ok({ type: "silent" });
      }
    }

    if (!prompt) return ok({ type: "silent" });

    // Archive previous name on rework
    if (isRework && names[sessionId]) {
      const algoStatePath = join(deps.baseDir, "MEMORY", "STATE", "algorithms", `${sessionId}.json`);
      const archiveResult = deps.readJson<AlgorithmState>(algoStatePath);
      if (archiveResult.ok) {
        const algoState = archiveResult.value;
        if (!algoState.previousNames) algoState.previousNames = [];
        algoState.previousNames.push({ name: names[sessionId], changedAt: new Date().toISOString() });
        deps.writeFile(algoStatePath, JSON.stringify(algoState, null, 2));
      }
    }

    // AI-generated name via inference (catch failure gracefully)
    let named = false;
    const inferenceResult = await deps.inference({
      systemPrompt: NAME_PROMPT,
      userPrompt: prompt.slice(0, 800),
      level: "fast",
      timeout: 10000,
    }).catch(() => null);

    if (inferenceResult?.success && inferenceResult.output) {
      let label = inferenceResult.output.replace(/^["']|["']$/g, "").replace(/[.!?,;:]/g, "").trim();
      const words = label.split(/\s+/).slice(0, 3);
      label = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

      const allWordsSubstantial = words.every((w) => w.length >= 3);
      if (label && words.length >= 2 && words.length <= 3 && allWordsSubstantial) {
        if (!isNameRelevantToPrompt(label, prompt)) {
          deps.stderr(`[SessionAutoName] Rejected contaminated name: "${label}"`);
        } else {
          storeName(names, namesPath, sessionId, label, deps);
          deps.stderr(`[SessionAutoName] ${isRework ? "Rejuvenated" : "Named"} session: "${label}" (inference)`);
          named = true;
        }
      }
    }

    // Conservative fallback
    if (!named) {
      const fallback = extractFallbackName(prompt);
      if (fallback) {
        storeName(names, namesPath, sessionId, fallback, deps);
        deps.stderr(`[SessionAutoName] Named session: "${fallback}" (fallback)`);
      }
    }

    return ok({ type: "silent" });
  },

  defaultDeps,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function storeName(
  names: SessionNames,
  namesPath: string,
  sessionId: string,
  label: string,
  deps: SessionAutoNameDeps,
): void {
  deps.ensureDir(dirname(namesPath));

  names[sessionId] = label;
  deps.writeFile(namesPath, JSON.stringify(names, null, 2));

  const cachePath = join(deps.baseDir, "MEMORY", "STATE", "session-name-cache.sh");
  deps.writeFile(cachePath, `cached_session_id='${sessionId}'\ncached_session_label='${label}'\n`);
}
