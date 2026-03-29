#!/usr/bin/env bun

// Cycle 7: Persistent Index Builder + Single-File Checker
//
// PROBLEM: Every variant parses all 214 files from scratch (200ms). The council
// agreed the production hook needs a persistent index with O(1) lookups. This
// variant builds that index and provides a single-file checker that reads it.
//
// INDEX FORMAT: JSON file with per-function entries. Body node types are condensed
// into a frequency vector fingerprint (32 bytes) instead of storing the full list
// (avg 69 items per function). This keeps the index under 200KB while enabling
// approximate body similarity via fingerprint comparison.
//
// Usage:
//   Build index:  bun Tools/pattern-detector/variants/index-builder.ts build <directory> [--output .duplication-index.json]
//   Check file:   bun Tools/pattern-detector/variants/index-builder.ts check <file> [--index .duplication-index.json] [--threshold 0.5]
//   Stats:        bun Tools/pattern-detector/variants/index-builder.ts stats [--index .duplication-index.json]

import { parseDirectory, parseFile } from "@tools/pattern-detector/parse";

// ─── Condensed Body Fingerprint ─────────────────────────────────────────────
// Instead of storing the full bodyNodeTypes array (avg 69 items), we store a
// frequency vector of the top-16 most common node types, encoded as a hex string.
// This enables approximate cosine similarity in O(1) without the full list.

const TOP_NODE_TYPES = [
  "Identifier",
  "CallExpression",
  "MemberExpression",
  "StringLiteral",
  "VariableDeclarator",
  "VariableDeclaration",
  "BlockStatement",
  "ReturnStatement",
  "IfStatement",
  "BinaryExpression",
  "ObjectExpression",
  "KeyValueProperty",
  "ExpressionStatement",
  "TemplateLiteral",
  "TemplateElement",
  "ArrayExpression",
] as const;

const NODE_TYPE_INDEX = new Map(TOP_NODE_TYPES.map((t, i) => [t, i]));

function buildBodyFingerprint(nodeTypes: string[]): string {
  // Count occurrences of top-16 node types, clamp to 0-255, encode as hex
  const counts = new Uint8Array(16);
  for (const t of nodeTypes) {
    const idx = NODE_TYPE_INDEX.get(t as (typeof TOP_NODE_TYPES)[number]);
    if (idx !== undefined && counts[idx] < 255) counts[idx]++;
  }
  // Encode as 32-char hex string
  return Array.from(counts)
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("");
}

function fingerprintSimilarity(a: string, b: string): number {
  // Cosine similarity between two fingerprint vectors
  if (a.length !== 32 || b.length !== 32) return 0;

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < 16; i++) {
    const va = parseInt(a.slice(i * 2, i * 2 + 2), 16);
    const vb = parseInt(b.slice(i * 2, i * 2 + 2), 16);
    dotProduct += va * vb;
    magA += va * va;
    magB += vb * vb;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dotProduct / denom;
}

// ─── Index Types ────────────────────────────────────────────────────────────

interface IndexEntry {
  f: string; // file path (relative to index root)
  n: string; // function name
  l: number; // line number
  h: string; // body hash (16-char hex)
  p: string; // param types comma-joined
  r: string; // return type
  fp: string; // body fingerprint (32-char hex)
  s: number; // body size (node count)
}

interface DuplicationIndex {
  version: 1;
  root: string;
  builtAt: string;
  fileCount: number;
  functionCount: number;
  entries: IndexEntry[];
  // Pre-built lookup maps serialized as arrays of [key, indices[]]
  hashGroups: [string, number[]][];
  nameGroups: [string, number[]][];
  sigGroups: [string, number[]][];
}

// ─── Index Building ─────────────────────────────────────────────────────────

function buildIndex(directory: string): DuplicationIndex {
  const { resolve } = require("node:path");
  const root = resolve(directory) as string;
  const files = parseDirectory(directory);
  const entries: IndexEntry[] = [];

  for (const file of files) {
    const relPath = file.path.startsWith(root) ? file.path.slice(root.length + 1) : file.path;
    for (const fn of file.functions) {
      entries.push({
        f: relPath,
        n: fn.name,
        l: fn.line,
        h: fn.bodyHash,
        p: fn.params.map((p) => p.typeAnnotation ?? "").join(","),
        r: fn.returnType ?? "",
        fp: buildBodyFingerprint(fn.bodyNodeTypes),
        s: fn.bodyNodeTypes.length,
      });
    }
  }

  // Build lookup maps
  const hashGroups = groupByField(entries, (e) => e.h);
  const nameGroups = groupByField(entries, (e) => e.n);
  const sigGroups = groupByField(entries, (e) => `(${e.p})→${e.r}`);

  return {
    version: 1,
    root,
    builtAt: new Date().toISOString(),
    fileCount: files.length,
    functionCount: entries.length,
    entries,
    hashGroups: [...hashGroups.entries()].filter(([_, idxs]) => idxs.length >= 2),
    nameGroups: [...nameGroups.entries()].filter(([_, idxs]) => idxs.length >= 2),
    sigGroups: [...sigGroups.entries()].filter(([_, idxs]) => idxs.length >= 3),
  };
}

function groupByField(
  entries: IndexEntry[],
  keyFn: (e: IndexEntry) => string,
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < entries.length; i++) {
    const key = keyFn(entries[i]);
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  }
  return groups;
}

// ─── Single-File Checking ───────────────────────────────────────────────────

interface CheckResult {
  function: string;
  line: number;
  matches: MatchDetail[];
}

interface MatchDetail {
  signal: "hash" | "name" | "signature" | "fingerprint";
  target: string; // file:name:line of the match
  score: number; // 0-1
}

function checkFile(filePath: string, index: DuplicationIndex, threshold: number): CheckResult[] {
  const parsed = parseFile(filePath);
  if (!parsed) return [];

  // Rebuild lookup maps from serialized form
  const hashMap = new Map(index.hashGroups);
  const nameMap = new Map(index.nameGroups);
  const sigMap = new Map(index.sigGroups);

  const results: CheckResult[] = [];

  for (const fn of parsed.functions) {
    const matches: MatchDetail[] = [];

    // Signal 1: Hash match (exact structural duplicate)
    const hashPeers = hashMap.get(fn.bodyHash);
    if (hashPeers) {
      for (const idx of hashPeers) {
        const peer = index.entries[idx];
        if (peer.f === filePath || (peer.n === fn.name && peer.l === fn.line)) continue;
        matches.push({
          signal: "hash",
          target: `${peer.f}:${peer.n}:${peer.l}`,
          score: 1.0,
        });
      }
    }

    // Signal 2: Name match
    const namePeers = nameMap.get(fn.name);
    if (namePeers) {
      for (const idx of namePeers) {
        const peer = index.entries[idx];
        if (peer.f === filePath) continue;
        matches.push({
          signal: "name",
          target: `${peer.f}:${peer.n}:${peer.l}`,
          score: Math.min(1.0, namePeers.length / 10),
        });
      }
    }

    // Signal 3: Type signature match
    const sig = `(${fn.params.map((p) => p.typeAnnotation ?? "").join(",")})→${fn.returnType ?? ""}`;
    const sigPeers = sigMap.get(sig);
    if (sigPeers) {
      // Check fingerprint similarity for top matches only
      const fp = buildBodyFingerprint(fn.bodyNodeTypes);
      const scored = sigPeers
        .map((idx) => ({ idx, sim: fingerprintSimilarity(fp, index.entries[idx].fp) }))
        .filter((s) => s.sim >= threshold && index.entries[s.idx].f !== filePath)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3);

      for (const s of scored) {
        const peer = index.entries[s.idx];
        matches.push({
          signal: "fingerprint",
          target: `${peer.f}:${peer.n}:${peer.l}`,
          score: s.sim,
        });
      }
    }

    if (matches.length > 0) {
      // Deduplicate by target, keep highest-signal match
      const best = new Map<string, MatchDetail>();
      for (const m of matches) {
        const existing = best.get(m.target);
        if (!existing || m.score > existing.score) best.set(m.target, m);
      }

      results.push({
        function: fn.name,
        line: fn.line,
        matches: [...best.values()].sort((a, b) => b.score - a.score).slice(0, 5),
      });
    }
  }

  return results;
}

// ─── Output Formatting ──────────────────────────────────────────────────────

function formatCheckResults(results: CheckResult[], _filePath: string, indexAge: string): string {
  if (results.length === 0) return "";

  const lines: string[] = [];
  for (const r of results) {
    const topMatch = r.matches[0];
    const signalCount = new Set(r.matches.map((m) => m.signal)).size;
    const dimBar = "●".repeat(signalCount) + "○".repeat(4 - signalCount);
    lines.push(
      `[${dimBar}] ${r.function}:${r.line} → ${topMatch.target} (${topMatch.signal}:${(topMatch.score * 100).toFixed(0)}%)`,
    );
  }

  return `Duplication check (index: ${indexAge}):\n${lines.join("\n")}`;
}

function formatStats(index: DuplicationIndex): string {
  const lines: string[] = [];
  lines.push("\nDuplication Index Stats");
  lines.push("═".repeat(30));
  lines.push(`Root: ${index.root}`);
  lines.push(`Built: ${index.builtAt}`);
  lines.push(`Files: ${index.fileCount}`);
  lines.push(`Functions: ${index.functionCount}`);
  lines.push(`Index entries: ${index.entries.length}`);
  lines.push(`Hash groups (2+ members): ${index.hashGroups.length}`);
  lines.push(`Name groups (2+ members): ${index.nameGroups.length}`);
  lines.push(`Signature groups (3+ members): ${index.sigGroups.length}`);

  const jsonSize = JSON.stringify(index).length;
  lines.push(`Index size: ${(jsonSize / 1024).toFixed(1)}KB`);

  return lines.join("\n");
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

if (!command || !["build", "check", "stats"].includes(command)) {
  process.stderr.write("Usage:\n");
  process.stderr.write(
    "  bun Tools/pattern-detector/variants/index-builder.ts build <directory> [--output .duplication-index.json]\n",
  );
  process.stderr.write(
    "  bun Tools/pattern-detector/variants/index-builder.ts check <file> [--index .duplication-index.json] [--threshold 0.5]\n",
  );
  process.stderr.write(
    "  bun Tools/pattern-detector/variants/index-builder.ts stats [--index .duplication-index.json]\n",
  );
  process.exit(1);
}

function getStringFlag(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return defaultVal;
}

function getNumFlag(name: string, defaultVal: number): number {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return parseFloat(args[idx + 1]);
  return defaultVal;
}

const defaultIndexPath = ".duplication-index.json";

if (command === "build") {
  const directory = args[1];
  if (!directory) {
    process.stderr.write("Error: directory required\n");
    process.exit(1);
  }
  const outputPath = getStringFlag("output", defaultIndexPath);

  const start = performance.now();
  const index = buildIndex(directory);
  const buildTimeMs = performance.now() - start;

  const json = JSON.stringify(index);
  require("node:fs").writeFileSync(outputPath, json);

  process.stderr.write(
    `Built index: ${index.functionCount} functions from ${index.fileCount} files in ${buildTimeMs.toFixed(0)}ms\n`,
  );
  process.stderr.write(`Written to: ${outputPath} (${(json.length / 1024).toFixed(1)}KB)\n`);
  process.stdout.write(`${formatStats(index)}\n`);
}

if (command === "check") {
  const filePath = args[1];
  if (!filePath) {
    process.stderr.write("Error: file path required\n");
    process.exit(1);
  }
  const indexPath = getStringFlag("index", defaultIndexPath);
  const threshold = getNumFlag("threshold", 0.5);

  const fs = require("node:fs");
  if (!fs.existsSync(indexPath)) {
    process.stderr.write(`Error: index not found at ${indexPath}. Run 'build' first.\n`);
    process.exit(1);
  }

  const start = performance.now();
  const index: DuplicationIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  const loadTimeMs = performance.now() - start;

  const checkStart = performance.now();
  const results = checkFile(filePath, index, threshold);
  const checkTimeMs = performance.now() - checkStart;

  const indexDate = new Date(index.builtAt);
  const ageMs = Date.now() - indexDate.getTime();
  const ageSec = Math.round(ageMs / 1000);
  const ageStr = ageSec < 60 ? `${ageSec}s` : `${Math.round(ageSec / 60)}m`;
  const stalePrefix = ageSec > 300 ? "stale:" : "";

  process.stderr.write(
    `Loaded index in ${loadTimeMs.toFixed(0)}ms, checked in ${checkTimeMs.toFixed(1)}ms\n`,
  );

  if (results.length > 0) {
    process.stdout.write(`${stalePrefix}${formatCheckResults(results, filePath, ageStr)}\n`);
  } else {
    process.stderr.write("No duplication signals found.\n");
  }
}

if (command === "stats") {
  const indexPath = getStringFlag("index", defaultIndexPath);
  const fs = require("node:fs");
  if (!fs.existsSync(indexPath)) {
    process.stderr.write(`Error: index not found at ${indexPath}. Run 'build' first.\n`);
    process.exit(1);
  }
  const index: DuplicationIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  process.stdout.write(`${formatStats(index)}\n`);
}
