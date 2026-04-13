/**
 * Shared types and logic for the DuplicationDetection hook group.
 *
 * Contains: index types, index loading/caching, fingerprint similarity,
 * duplication checking, and output formatting.
 *
 * Parsing logic lives in parser.ts (separate concern).
 */

import { execSyncSafe } from "@hooks/core/adapters/process";
import { tryCatch } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ExtractedFunction } from "@hooks/hooks/DuplicationDetection/parser";

// ─── Index Types ────────────────────────────────────────────────────────────

export interface IndexEntry {
  f: string;
  n: string;
  l: number;
  h: string;
  p: string;
  r: string;
  fp: string;
  s: number;
  source?: boolean;
}

export interface DuplicationIndex {
  version: number;
  root: string;
  branch?: string;
  builtAt: string;
  fileCount: number;
  functionCount: number;
  entries: IndexEntry[];
  hashGroups: [string, number[]][];
  nameGroups: [string, number[]][];
  sigGroups: [string, number[]][];
  patterns?: PatternEntry[];
}

export interface DuplicationMatch {
  functionName: string;
  line: number;
  targetFile: string;
  targetName: string;
  targetLine: number;
  signals: string[];
  topScore: number;
  derivation?: boolean;
  targetIsSource?: boolean;
}

export interface PatternEntry {
  id: string;
  name: string;
  sig: string;
  tier: 1 | 2;
  fileCount: number;
  files: string[];
}

// ─── Deps ───────────────────────────────────────────────────────────────────

export interface SharedDeps {
  readFile: (path: string) => string | null;
  exists: (path: string) => boolean;
}

// ─── Tool Input Helpers ────────────────────────────────────────────────────
// Moved to lib/tool-input.ts — import directly from there.

/** Apply an Edit operation to existing file content. */
export function simulateEdit(currentContent: string, input: ToolHookInput): string {
  const toolInput = input.tool_input as Record<string, unknown>;
  const oldStr = toolInput.old_string as string | undefined;
  const newStr = toolInput.new_string as string | undefined;
  if (oldStr && newStr !== undefined) return currentContent.replace(oldStr, newStr);
  return currentContent;
}

// ─── Sig Normalization ─────────────────────────────────────────────────────

export function normalizeParam(param: string): string {
  let p = param;
  p = p.replace(/Partial<\w+>/g, "Partial<*>");
  p = p.replace(/Record<\w+,\w+>/g, "Record<*,*>");
  return p;
}

export function normalizeReturn(ret: string): string {
  let r = ret;
  r = r.replace(/\w+Deps$/, "*Deps");
  r = r.replace(/\w+Input$/, "*Input");
  r = r.replace(/\w+Output$/, "*Output");
  return r;
}

const PRIMITIVE_RETURNS = new Set([
  "string",
  "number",
  "boolean",
  "void",
  "{object}",
  "",
  "string|null",
]);

export function isPrimitiveReturn(normalizedReturn: string): boolean {
  return PRIMITIVE_RETURNS.has(normalizedReturn);
}

// ─── Branch Detection ──────────────────────────────────────────────────────

/**
 * Get the current git branch name. Returns null if not in a git repo
 * or git is unavailable. Shared across the hook group so both the
 * builder and checker use the same branch resolution.
 */
export function getCurrentBranch(cwd?: string): string | null {
  const result = execSyncSafe("git rev-parse --abbrev-ref HEAD", { cwd });
  if (!result.ok) return null;
  const branch = result.value.trim();
  return branch.length > 0 ? branch : null;
}

// ─── Project Markers ───────────────────────────────────────────────────────

export const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "composer.json",
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
];

// ─── Artifact Location ─────────────────────────────────────────────────────

const ARTIFACTS_BASE = "/tmp/pai/duplication";

/** Deterministic hash of a project root path for cache namespacing. */
export function projectHash(root: string): string {
  let h = 0;
  for (let i = 0; i < root.length; i++) {
    h = ((h << 5) - h + root.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0");
}

/** Sanitize branch name for use as directory segment. */
function sanitizeBranch(branch: string): string {
  return branch.replace(/[/\\]/g, "-");
}

/** Returns the artifacts directory: /tmp/pai/duplication/{hash}/{branch}/ */
export function getArtifactsDir(projectRoot: string, branch?: string | null): string {
  const branchDir = sanitizeBranch(branch || "default");
  return `${ARTIFACTS_BASE}/${projectHash(projectRoot)}/${branchDir}`;
}

// ─── Index Loading ──────────────────────────────────────────────────────────

// Module-level cache: safe because each hook invocation runs in a separate process.
// If hooks ever run in-process (e.g. test harness), this cache would serve stale data.
let cachedIndex: DuplicationIndex | null = null;
let cachedIndexPath: string | null = null;

export function loadIndex(indexPath: string, deps: SharedDeps): DuplicationIndex | null {
  if (cachedIndex && cachedIndexPath === indexPath) return cachedIndex;
  const content = deps.readFile(indexPath);
  if (!content) return null;
  const parseResult = tryCatch(
    () => JSON.parse(content) as DuplicationIndex,
    () => null,
  );
  if (!parseResult.ok) return null;
  const parsed = parseResult.value;
  if (!parsed.version || !parsed.entries) return null;

  // Branch isolation is now handled by directory structure (/tmp/pai/duplication/{hash}/{branch}/)

  cachedIndex = parsed;
  cachedIndexPath = indexPath;
  return parsed;
}

export function clearIndexCache(): void {
  cachedIndex = null;
  cachedIndexPath = null;
}

export function findIndexPath(filePath: string, deps: SharedDeps): string | null {
  const { dirname } = require("node:path");
  const startDir = dirname(filePath) as string;
  const branch = getCurrentBranch(startDir) ?? "default";

  // Check the path itself first (handles directory inputs from SessionStart)
  const selfCandidate = `${getArtifactsDir(filePath, branch)}/index.json`;
  if (deps.exists(selfCandidate)) return selfCandidate;

  // Walk up from dirname
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = `${getArtifactsDir(dir, branch)}/index.json`;
    if (deps.exists(candidate)) return candidate;
    // Legacy location fallback
    const legacy = `${dir}/.claude/.duplication-index.json`;
    if (deps.exists(legacy)) return legacy;
    const parent = dirname(dir) as string;
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ─── Fingerprint Similarity ─────────────────────────────────────────────────

export function fingerprintSimilarity(a: string, b: string): number {
  if (a.length !== 32 || b.length !== 32) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < 16; i++) {
    const va = parseInt(a.slice(i * 2, i * 2 + 2), 16);
    const vb = parseInt(b.slice(i * 2, i * 2 + 2), 16);
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Checking Logic ─────────────────────────────────────────────────────────

/** Minimum signal count to log a match (2/4 = log, 4/4 = block). */
export const LOG_THRESHOLD = 2;
/** Signal count at which the match becomes a block (all 4 dimensions). */
export const BLOCK_THRESHOLD = 4;
const FINGERPRINT_THRESHOLD = 0.5;
const MAX_FINDINGS = 3;

export function checkFunctions(
  functions: ExtractedFunction[],
  index: DuplicationIndex,
  filePath: string,
): DuplicationMatch[] {
  const hashMap = new Map(index.hashGroups);
  const nameMap = new Map(index.nameGroups);
  const sigMap = new Map(index.sigGroups);
  const matches: DuplicationMatch[] = [];

  for (const fn of functions) {
    const signals: string[] = [];
    let bestTarget: { file: string; name: string; line: number; source?: boolean } | null = null;
    let topScore = 0;

    let isDerivation = false;
    const fnSig = `(${fn.paramSig})→${fn.returnType}`;
    const hashPeers = hashMap.get(fn.bodyHash);
    if (hashPeers) {
      for (const idx of hashPeers) {
        const peer = index.entries[idx];
        if (peer.f === filePath) continue;
        const peerSig = `(${peer.p})→${peer.r}`;
        if (fnSig !== peerSig) {
          isDerivation = true;
          bestTarget = { file: peer.f, name: peer.n, line: peer.l, source: peer.source };
          topScore = 1.0;
          break;
        }
        signals.push("hash");
        bestTarget = { file: peer.f, name: peer.n, line: peer.l, source: peer.source };
        topScore = 1.0;
        break;
      }
    }

    const namePeers = nameMap.get(fn.name);
    if (namePeers && namePeers.length >= 3) {
      signals.push("name");
      if (!bestTarget) {
        const peer = index.entries[namePeers[0]];
        bestTarget = { file: peer.f, name: peer.n, line: peer.l, source: peer.source };
      }
      topScore = Math.max(topScore, Math.min(1.0, namePeers.length / 10));
    }

    const sig = `(${fn.paramSig})→${fn.returnType}`;
    const sigPeers = sigMap.get(sig);
    if (sigPeers && sigPeers.length >= 3) {
      signals.push("sig");
      for (const idx of sigPeers) {
        const peer = index.entries[idx];
        if (peer.f === filePath) continue;
        const sim = fingerprintSimilarity(fn.fingerprint, peer.fp);
        if (sim >= FINGERPRINT_THRESHOLD) {
          signals.push("body");
          if (sim > topScore) {
            topScore = sim;
            bestTarget = { file: peer.f, name: peer.n, line: peer.l, source: peer.source };
          }
          break;
        }
      }
    }

    if (isDerivation && bestTarget) {
      matches.push({
        functionName: fn.name,
        line: fn.line,
        targetFile: bestTarget.file,
        targetName: bestTarget.name,
        targetLine: bestTarget.line,
        signals: ["hash"],
        topScore,
        derivation: true,
        targetIsSource: bestTarget.source,
      });
    } else if (signals.length >= LOG_THRESHOLD && bestTarget) {
      matches.push({
        functionName: fn.name,
        line: fn.line,
        targetFile: bestTarget.file,
        targetName: bestTarget.name,
        targetLine: bestTarget.line,
        signals,
        topScore,
        targetIsSource: bestTarget.source,
      });
    }
  }

  return matches.slice(0, MAX_FINDINGS);
}

// ─── Output Formatting ──────────────────────────────────────────────────────

export function formatMatch(m: DuplicationMatch): string {
  if (m.derivation) {
    return `Derivation: ${m.functionName} has identical body to ${m.targetFile}:${m.targetName} but different signature — possible derivation issue`;
  }
  const sigStr = m.signals.join("+");
  const score = (m.topScore * 100).toFixed(0);
  return `Similar: ${m.functionName} → ${m.targetFile}:${m.targetName} (${sigStr}, ${score}%)`;
}
