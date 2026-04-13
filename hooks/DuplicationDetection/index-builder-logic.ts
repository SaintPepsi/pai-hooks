/**
 * Index building logic for DuplicationDetection.
 *
 * Scans a directory for .ts files, extracts functions via parser.ts,
 * builds lookup maps, and produces a DuplicationIndex.
 *
 * Used by DuplicationIndexBuilder contract. Separated from shared.ts
 * to keep the checker's import surface minimal.
 */

import { basename, extname } from "node:path";
import type { ParserDeps } from "@hooks/hooks/DuplicationDetection/parser";
import { extractFunctions } from "@hooks/hooks/DuplicationDetection/parser";
import {
  type DuplicationIndex,
  getCurrentBranch,
  type IndexEntry,
  isPrimitiveReturn,
  normalizeParam,
  normalizeReturn,
  type PatternEntry,
} from "@hooks/hooks/DuplicationDetection/shared";

// ─── Deps ───────────────────────────────────────────────────────────────────

export interface IndexBuilderDeps {
  readDir: (path: string) => string[] | null;
  readFile: (path: string) => string | null;
  isDirectory: (path: string) => boolean;
  exists: (path: string) => boolean;
  stat: (path: string) => { mtimeMs: number } | null;
  join: (...parts: string[]) => string;
  resolve: (path: string) => string;
  parserDeps: ParserDeps;
}

// ─── Source Heuristic ───────────────────────────────────────────────────────

const SOURCE_DIRS = new Set(["lib", "core", "utils", "shared"]);

/**
 * Convert kebab-case to camelCase: "hook-config" → "hookConfig"
 */
export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Returns true when a file is likely a canonical source (not a consumer).
 * Criteria: lives in a source directory (lib/core/utils/shared), has exactly
 * one function in the file, and the function name matches the filename stem
 * (with kebab-case → camelCase normalization).
 */
export function isSourceFile(relPath: string, fnName: string, fileEntryCount: number): boolean {
  if (fileEntryCount !== 1) return false;
  const parts = relPath.split("/");
  const inSourceDir = parts.some((p) => SOURCE_DIRS.has(p));
  if (!inSourceDir) return false;
  const stem = basename(relPath, extname(relPath));
  // Match exact (e.g., "pipe" === "pipe") or kebab-to-camel (e.g., "hook-config" → "hookConfig")
  return stem === fnName || kebabToCamel(stem) === fnName;
}

// ─── File Scanning ──────────────────────────────────────────────────────────

export function findTsFiles(dir: string, deps: IndexBuilderDeps): string[] {
  const results: string[] = [];
  const absDir = deps.resolve(dir);

  function walk(d: string): void {
    const entries = deps.readDir(d);
    if (!entries) return;
    for (const entry of entries) {
      if (
        entry === "node_modules" ||
        entry === ".git" ||
        entry === "coverage" ||
        entry === ".worktrees"
      )
        continue;
      const full = deps.join(d, entry);
      if (deps.isDirectory(full)) {
        walk(full);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
        results.push(full);
      }
    }
  }

  walk(absDir);
  return results.sort();
}

// ─── Index Building ─────────────────────────────────────────────────────────

function groupByField(
  entries: IndexEntry[],
  keyFn: (e: IndexEntry) => string,
): [string, number[]][] {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < entries.length; i++) {
    const key = keyFn(entries[i]);
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  }
  return [...groups.entries()];
}

export function buildIndex(directory: string, deps: IndexBuilderDeps): DuplicationIndex {
  const root = deps.resolve(directory);
  const files = findTsFiles(directory, deps);
  const entries: IndexEntry[] = [];

  for (const filePath of files) {
    const content = deps.readFile(filePath);
    if (!content) continue;

    const relPath = filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath;
    const isTsx = filePath.endsWith(".tsx");
    const functions = extractFunctions(content, isTsx, deps.parserDeps);

    for (const fn of functions) {
      const source = isSourceFile(relPath, fn.name, functions.length) || undefined;
      entries.push({
        f: relPath,
        n: fn.name,
        l: fn.line,
        h: fn.bodyHash,
        p: fn.paramSig,
        r: fn.returnType,
        fp: fn.fingerprint,
        s: 0, // body size not needed for checker, keep lightweight
        source,
      });
    }
  }

  const branch = getCurrentBranch(root);

  return buildResult(root, entries, files.length, branch);
}

// ─── Pattern Detection ─────────────────────────────────────────────────────

const DEFAULT_PATTERN_THRESHOLD = 5;
const DEFAULT_SIG_MATCH_PERCENT = 60;

function detectPatterns(
  entries: IndexEntry[],
  nameGroups: [string, number[]][],
  threshold: number = DEFAULT_PATTERN_THRESHOLD,
  sigMatchPercent: number = DEFAULT_SIG_MATCH_PERCENT,
): PatternEntry[] {
  const patterns: PatternEntry[] = [];
  const minRatio = sigMatchPercent / 100;

  for (const [name, indices] of nameGroups) {
    if (indices.length < threshold) continue;

    // Tier 1: full normalized sig match (params + return)
    const fullSigCounts = new Map<string, number>();
    const filesByFullSig = new Map<string, string[]>();
    for (const idx of indices) {
      const e = entries[idx];
      const normSig = `(${normalizeParam(e.p)})→${normalizeReturn(e.r)}`;
      fullSigCounts.set(normSig, (fullSigCounts.get(normSig) ?? 0) + 1);
      const files = filesByFullSig.get(normSig) ?? [];
      files.push(e.f);
      filesByFullSig.set(normSig, files);
    }

    let topFullSig = "";
    let topFullCount = 0;
    for (const [sig, count] of fullSigCounts) {
      if (count > topFullCount) {
        topFullSig = sig;
        topFullCount = count;
      }
    }

    if (topFullCount / indices.length >= minRatio) {
      // Extract return type from sig format "(params)→return"
      const retPart = topFullSig.slice(topFullSig.indexOf("→") + 1);
      if (isPrimitiveReturn(retPart)) continue;

      const files = filesByFullSig.get(topFullSig) ?? [];
      const uniqueFiles = [...new Set(files)];
      patterns.push({
        id: `${name}:${topFullSig}`,
        name,
        sig: topFullSig,
        tier: 1,
        fileCount: uniqueFiles.length,
        files: uniqueFiles.slice(0, 5),
      });
      continue;
    }

    // Tier 2: return-only fallback (domain types only)
    const retCounts = new Map<string, number>();
    const filesByRet = new Map<string, string[]>();
    for (const idx of indices) {
      const e = entries[idx];
      const normRet = normalizeReturn(e.r);
      retCounts.set(normRet, (retCounts.get(normRet) ?? 0) + 1);
      const files = filesByRet.get(normRet) ?? [];
      files.push(e.f);
      filesByRet.set(normRet, files);
    }

    let topRet = "";
    let topRetCount = 0;
    for (const [ret, count] of retCounts) {
      if (count > topRetCount) {
        topRet = ret;
        topRetCount = count;
      }
    }

    if (topRetCount / indices.length >= minRatio && !isPrimitiveReturn(topRet)) {
      const files = filesByRet.get(topRet) ?? [];
      const uniqueFiles = [...new Set(files)];
      patterns.push({
        id: `${name}:()→${topRet}`,
        name,
        sig: `()→${topRet}`,
        tier: 2,
        fileCount: uniqueFiles.length,
        files: uniqueFiles.slice(0, 5),
      });
    }
  }

  return patterns;
}

function buildResult(
  root: string,
  entries: IndexEntry[],
  fileCount: number,
  branch: string | null,
): DuplicationIndex {
  const nameGroups = groupByField(entries, (e) => e.n).filter(([_, idxs]) => idxs.length >= 2);

  return {
    version: 1,
    root,
    branch: branch ?? undefined,
    builtAt: new Date().toISOString(),
    fileCount,
    functionCount: entries.length,
    entries,
    hashGroups: groupByField(entries, (e) => e.h).filter(([_, idxs]) => idxs.length >= 2),
    nameGroups,
    sigGroups: groupByField(entries, (e) => `(${e.p})→${e.r}`).filter(
      ([_, idxs]) => idxs.length >= 3,
    ),
    patterns: detectPatterns(entries, nameGroups),
  };
}

/** Surgical update: re-index a single file within an existing index. */
export function updateIndexForFile(
  existingIndex: DuplicationIndex,
  filePath: string,
  content: string,
  deps: IndexBuilderDeps,
): DuplicationIndex {
  const root = existingIndex.root;
  const relPath = filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath;

  // Remove old entries for this file
  const keptEntries = existingIndex.entries.filter((e) => e.f !== relPath);

  // Extract new functions from the updated content
  const isTsx = filePath.endsWith(".tsx");
  const functions = extractFunctions(content, isTsx, deps.parserDeps);

  for (const fn of functions) {
    const source = isSourceFile(relPath, fn.name, functions.length) || undefined;
    keptEntries.push({
      f: relPath,
      n: fn.name,
      l: fn.line,
      h: fn.bodyHash,
      p: fn.paramSig,
      r: fn.returnType,
      fp: fn.fingerprint,
      s: 0,
      source,
    });
  }

  const branch = getCurrentBranch(root);
  const actualFileCount = new Set(keptEntries.map((e) => e.f)).size;
  return buildResult(root, keptEntries, actualFileCount, branch);
}
