/**
 * Quality Scorer — SOLID heuristic analysis for source code files.
 *
 * Accepts file content + language profile, returns a composite quality score
 * (0-10) with per-check breakdown. All checks are heuristic, not AST-based.
 *
 * 15 checks across 4 SOLID categories:
 *   SRP (1-4): function count, naming clusters, mixed I/O, section headers
 *   DIP (5-8): import depth, infra imports, type import ratio, missing Deps, throw count, null returns, mixed error strategy
 *   ISP (9-11): interface size, parameter count, options width
 *   DIP enforcement (12): relative import depth
 */

import type { LanguageProfile } from "@hooks/core/language-profiles";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Severity = "minor" | "moderate" | "major";

export interface Violation {
  check: string;
  category: "SRP" | "DIP" | "ISP";
  severity: Severity;
  message: string;
  value: number;
  threshold: number;
}

export interface QualityScore {
  score: number;
  violations: Violation[];
  checkResults: CheckResult[];
}

export interface CheckResult {
  check: string;
  passed: boolean;
  value: number;
  threshold: number;
}

// ─── Severity Weights ────────────────────────────────────────────────────────

const SEVERITY_WEIGHT: Record<Severity, number> = {
  minor: 0.25,
  moderate: 0.5,
  major: 1.0,
};

// ─── Individual Checks ───────────────────────────────────────────────────────

function countFunctions(content: string, profile: LanguageProfile): number {
  const matches = content.match(profile.functionPattern);
  return matches?.length ?? 0;
}

function countNamingClusters(content: string, profile: LanguageProfile): number {
  const matches = content.match(profile.functionPattern);
  if (!matches || matches.length === 0) return 0;

  const prefixes = new Set<string>();
  for (const match of matches) {
    const name = match.trim().split(/[\s(]+/).pop()?.replace(/^(async|function|def|fn|func|pub)\s*/i, "");
    if (!name) continue;
    const cleaned = name.replace(/^(get|set|is|has|on|handle|create|update|delete|find|fetch|load|save|parse|format|validate|check|ensure|build|make|render|process|compute|calculate|resolve|init|setup|configure|register|unregister|add|remove|clear|reset|start|stop|run|exec|apply|emit|dispatch|notify|log|debug|warn|error|throw|assert)/i, "");
    if (cleaned && cleaned !== name) {
      prefixes.add(name.slice(0, name.length - cleaned.length).toLowerCase());
    }
  }
  return prefixes.size;
}

function countMixedIOPatterns(content: string): number {
  // Filter out lines that are regex patterns, string patterns, or comments
  const lines = content.split("\n");
  const codeLines = lines.filter(l => {
    const trimmed = l.trim();
    // Skip comment lines
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return false;
    // Skip lines that are regex definitions (contain /pattern/)
    if (/^\s*(?:const|let|var)\s+\w+\s*=\s*\//.test(trimmed)) return false;
    // Skip lines inside INFRA_PATTERNS-style arrays (regex array elements)
    if (/^\s*\/.*\/[gimsuy]*,?\s*$/.test(trimmed)) return false;
    return true;
  });
  const filtered = codeLines.join("\n");

  let patterns = 0;
  if (/(?:readFile|writeFile|existsSync|fs\.|path\.join|dirname|__dirname)/m.test(filtered)) patterns++;
  if (/(?:fetch\(|http\.|https\.|axios|got\(|request\()/m.test(filtered)) patterns++;
  if (/(?:query\(|execute\(|\.findOne|\.findMany|prisma\.|knex|sequelize|mongoose)/m.test(filtered)) patterns++;
  if (/(?:spawn\(|exec\(|execSync|child_process)/m.test(filtered)) patterns++;
  return patterns;
}

function countTryCatch(content: string): number {
  return (content.match(/\btry\s*\{/g) ?? []).length;
}

function countThrowStatements(content: string): number {
  const lines = content.split("\n");
  const codeLines = lines.filter(l => {
    const trimmed = l.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return false;
    return true;
  });
  return (codeLines.join("\n").match(/\bthrow\s+(?:new\s+)?\w+/g) ?? []).length;
}

function countNullReturns(content: string): number {
  const lines = content.split("\n");
  const codeLines = lines.filter(l => {
    const trimmed = l.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return false;
    return true;
  });
  return (codeLines.join("\n").match(/\breturn\s+(?:null|undefined)\b/g) ?? []).length;
}

function hasMixedErrorStrategy(content: string): number {
  const hasResultImport = /\bResult\b/.test(content) && /\bok\b|\berr\b/.test(content);
  const hasTryCatch = /\btry\s*\{/.test(content);
  const hasThrow = /\bthrow\s+(?:new\s+)?\w+/.test(content);
  if (hasResultImport && (hasTryCatch || hasThrow)) return 1;
  return 0;
}

function countSectionHeaders(content: string, profile: LanguageProfile): number {
  const prefix = profile.commentPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${prefix}\\s*[-─━═]+\\s*`, "gm");
  return (content.match(pattern) ?? []).length;
}

function maxImportDepth(content: string): number {
  const matches = content.match(/from\s+["'](\.\.[/"'][^"']+)["']/gm);
  if (!matches) return 0;

  let max = 0;
  for (const m of matches) {
    const path = m.match(/["']([^"']+)["']/)?.[1] ?? "";
    // SvelteKit convention: ./$types is auto-generated per-route, skip $-prefixed imports
    if (/^\.\/\$/.test(path)) continue;
    const depth = (path.match(/\.\.\//g) ?? []).length;
    if (depth > max) max = depth;
  }
  return max;
}

const INFRA_PATTERNS = [
  /from\s+["'](?:node:)?fs["']/m,
  /from\s+["'](?:node:)?http["']/m,
  /from\s+["'](?:node:)?https["']/m,
  /from\s+["'](?:node:)?net["']/m,
  /from\s+["'](?:node:)?child_process["']/m,
  /from\s+["'](?:node:)?crypto["']/m,
  /require\s*\(\s*["'](?:node:)?fs["']\s*\)/m,
];

function countInfraImports(content: string): number {
  // Only match actual import statements, not regex patterns or strings
  const importLines = content.split("\n").filter(l => {
    const trimmed = l.trim();
    return trimmed.startsWith("import ") || trimmed.startsWith("import{") || /^\s*(?:const|let|var)\s+.*=\s*require\s*\(/.test(trimmed);
  });
  const importContent = importLines.join("\n");
  return INFRA_PATTERNS.filter((p) => p.test(importContent)).length;
}

function typeImportRatio(content: string, profile: LanguageProfile): number {
  if (!profile.typeImportPattern) return -1;

  const totalImports = (content.match(profile.importPattern) ?? []).length;
  if (totalImports === 0) return -1;

  const typeImports = (content.match(profile.typeImportPattern) ?? []).length;
  return typeImports / totalImports;
}

function hasDepsInterface(content: string, filePath: string): boolean | null {
  if (!filePath.includes("/contracts/")) return null;
  if (filePath.includes(".test.") || filePath.includes(".spec.")) return null;
  return /interface\s+\w*Deps\b/m.test(content);
}

function maxInterfaceMembers(content: string): number {
  const interfaces = content.match(/interface\s+\w+[^{]*\{[^}]*\}/gms);
  if (!interfaces) return 0;

  let max = 0;
  for (const iface of interfaces) {
    const body = iface.slice(iface.indexOf("{") + 1, iface.lastIndexOf("}"));
    const members = body.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).length;
    if (members > max) max = members;
  }
  return max;
}

function maxParameterCount(content: string, profile: LanguageProfile): number {
  const matches = content.match(profile.functionPattern);
  if (!matches) return 0;

  let max = 0;
  for (const match of matches) {
    const start = content.indexOf(match);
    const parenStart = content.indexOf("(", start);
    if (parenStart === -1) continue;

    let depth = 1;
    let pos = parenStart + 1;
    while (pos < content.length && depth > 0) {
      if (content[pos] === "(") depth++;
      if (content[pos] === ")") depth--;
      pos++;
    }

    const params = content.slice(parenStart + 1, pos - 1).trim();
    if (!params) continue;

    let commaCount = 0;
    let parenDepth = 0;
    let braceDepth = 0;
    let angleDepth = 0;
    for (const ch of params) {
      if (ch === "(") parenDepth++;
      if (ch === ")") parenDepth--;
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
      if (ch === "<") angleDepth++;
      if (ch === ">") angleDepth--;
      if (ch === "," && parenDepth === 0 && braceDepth === 0 && angleDepth === 0) commaCount++;
    }

    const paramCount = commaCount + 1;
    if (paramCount > max) max = paramCount;
  }
  return max;
}

function maxOptionsObjectWidth(content: string): number {
  const objectParams = content.match(/\{\s*(?:\w+\s*[,:]\s*[^}]*){3,}\}/gms);
  if (!objectParams) return 0;

  let max = 0;
  for (const obj of objectParams) {
    const body = obj.slice(1, -1);
    let count = 0;
    let braceDepth = 0;
    for (const line of body.split(/[,;\n]/)) {
      const trimmed = line.trim();
      if (trimmed.includes("{")) braceDepth++;
      if (trimmed.includes("}")) braceDepth--;
      if (braceDepth === 0 && /^\w+\s*[:?]/.test(trimmed)) count++;
    }
    if (count > max) max = count;
  }
  return max;
}

function maxRelativeImportDepth(content: string): number {
  return maxImportDepth(content);
}

// ─── Score Computation ───────────────────────────────────────────────────────

interface CheckSpec {
  name: string;
  category: "SRP" | "DIP" | "ISP";
  severity: Severity;
  threshold: number;
  direction: "above" | "below";
  compute: (content: string, profile: LanguageProfile, filePath: string) => number;
  skip?: (profile: LanguageProfile, value: number) => boolean;
}

const CHECKS: CheckSpec[] = [
  // SRP
  {
    name: "function-count",
    category: "SRP",
    severity: "moderate",
    threshold: 15,
    direction: "above",
    compute: (c, p) => countFunctions(c, p),
  },
  {
    name: "naming-clusters",
    category: "SRP",
    severity: "minor",
    threshold: 5,
    direction: "above",
    compute: (c, p) => countNamingClusters(c, p),
  },
  {
    name: "mixed-io-patterns",
    category: "SRP",
    severity: "major",
    threshold: 1,
    direction: "above",
    compute: (c) => countMixedIOPatterns(c),
  },
  {
    name: "section-headers",
    category: "SRP",
    severity: "minor",
    threshold: 3,
    direction: "above",
    compute: (c, p) => countSectionHeaders(c, p),
  },
  // DIP
  {
    name: "import-depth",
    category: "DIP",
    severity: "moderate",
    threshold: 3,
    direction: "above",
    compute: (c) => maxImportDepth(c),
  },
  {
    name: "infra-imports",
    category: "DIP",
    severity: "moderate",
    threshold: 0,
    direction: "above",
    compute: (c, _p, filePath) => filePath?.includes("/adapters/") ? 0 : countInfraImports(c),
    skip: (_p, _v) => false,
  },
  {
    name: "type-import-ratio",
    category: "DIP",
    severity: "minor",
    threshold: 0.2,
    direction: "below",
    compute: (c, p) => typeImportRatio(c, p),
    skip: (_p, v) => v === -1,
  },
  {
    name: "missing-deps-interface",
    category: "DIP",
    severity: "major",
    threshold: 0,
    direction: "above",
    compute: (c, _p, f) => {
      const result = hasDepsInterface(c, f);
      if (result === null) return -1;
      return result ? 0 : 1;
    },
    skip: (_p, v) => v === -1,
  },
  // ISP
  {
    name: "interface-members",
    category: "ISP",
    severity: "moderate",
    threshold: 8,
    direction: "above",
    compute: (c) => maxInterfaceMembers(c),
    skip: (p) => !p.hasInterfaces,
  },
  {
    name: "parameter-count",
    category: "ISP",
    severity: "moderate",
    threshold: 5,
    direction: "above",
    compute: (c, p) => maxParameterCount(c, p),
  },
  {
    name: "options-object-width",
    category: "ISP",
    severity: "minor",
    threshold: 10,
    direction: "above",
    compute: (c) => maxOptionsObjectWidth(c),
  },
  // DIP enforcement
  {
    name: "relative-import-depth",
    category: "DIP",
    severity: "minor",
    threshold: 3,
    direction: "above",
    compute: (c) => maxRelativeImportDepth(c),
  },
  // SRP — try-catch overuse
  {
    name: "try-catch-count",
    category: "SRP",
    severity: "moderate",
    threshold: 2,
    direction: "above",
    compute: (c) => countTryCatch(c),
  },
  // DIP — contract must export HookContract
  {
    name: "contract-pattern",
    category: "DIP",
    severity: "major",
    threshold: 0,
    direction: "above",
    compute: (c, _p, f) => {
      if (!f.includes("/contracts/") || f.includes(".test.")) return -1;
      const hasExport = /export\s+const\s+\w+\s*:\s*(?:Sync|Async)?HookContract/m.test(c);
      return hasExport ? 0 : 1;
    },
    skip: (_p, v) => v === -1,
  },
  // DIP — contracts must not bypass adapters
  {
    name: "adapter-bypass",
    category: "DIP",
    severity: "major",
    threshold: 0,
    direction: "above",
    compute: (c, _p, f) => {
      if (!f.includes("/contracts/") || f.includes(".test.")) return -1;
      const importLines = c.split("\n").filter(l => l.trim().startsWith("import "));
      const importContent = importLines.join("\n");
      return INFRA_PATTERNS.filter(p => p.test(importContent)).length;
    },
    skip: (_p, v) => v === -1,
  },
  // DIP — ROP: producer-side exception detection
  {
    name: "throw-count",
    category: "DIP",
    severity: "moderate",
    threshold: 1,
    direction: "above",
    compute: (c, _p, f) => {
      if (f.includes("/adapters/") || f.includes(".test.")) return -1;
      return countThrowStatements(c);
    },
    skip: (_p, v) => v === -1,
  },
  // DIP — ROP: null returns instead of Result
  {
    name: "null-return-count",
    category: "DIP",
    severity: "minor",
    threshold: 2,
    direction: "above",
    compute: (c) => countNullReturns(c),
  },
  // DIP — ROP: mixed error strategies in same file
  {
    name: "mixed-error-strategy",
    category: "DIP",
    severity: "moderate",
    threshold: 0,
    direction: "above",
    compute: (c, _p, f) => {
      if (f.includes("/adapters/") || f.includes(".test.")) return -1;
      return hasMixedErrorStrategy(c);
    },
    skip: (_p, v) => v === -1,
  },
];

/**
 * Score a source file for SOLID quality.
 *
 * Returns a composite score (0-10) with per-check breakdown.
 * Higher is better. Perfect file = 10.0.
 */
export function scoreFile(
  content: string,
  profile: LanguageProfile,
  filePath: string,
): QualityScore {
  const violations: Violation[] = [];
  const checkResults: CheckResult[] = [];

  for (const check of CHECKS) {
    const value = check.compute(content, profile, filePath);

    if (check.skip?.(profile, value)) {
      continue;
    }

    const violated =
      check.direction === "above"
        ? value > check.threshold
        : value < check.threshold;

    checkResults.push({
      check: check.name,
      passed: !violated,
      value,
      threshold: check.threshold,
    });

    if (violated) {
      violations.push({
        check: check.name,
        category: check.category,
        severity: check.severity,
        message: formatViolation(check, value),
        value,
        threshold: check.threshold,
      });
    }
  }

  const totalPenalty = violations.reduce(
    (sum, v) => sum + SEVERITY_WEIGHT[v.severity],
    0,
  );

  const score = Math.max(0, Math.round((10 - totalPenalty) * 10) / 10);

  return { score, violations, checkResults };
}

function formatViolation(check: CheckSpec, value: number): string {
  switch (check.name) {
    case "function-count":
      return `${value} functions in file (threshold: ${check.threshold})`;
    case "naming-clusters":
      return `${value} distinct naming prefixes suggest multiple responsibilities`;
    case "mixed-io-patterns":
      return `${value} I/O patterns mixed in one file (fs, http, db, process)`;
    case "section-headers":
      return `${value} section headers suggest file should be split`;
    case "import-depth":
      return `Import depth ${value} levels (max recommended: ${check.threshold})`;
    case "infra-imports":
      return `${value} direct infrastructure imports (should go through adapters)`;
    case "type-import-ratio":
      return `Type import ratio ${(value * 100).toFixed(0)}% (min recommended: ${check.threshold * 100}%)`;
    case "missing-deps-interface":
      return "Hook/contract file missing Deps interface for dependency injection";
    case "interface-members":
      return `Interface has ${value} members (max recommended: ${check.threshold})`;
    case "parameter-count":
      return `Function has ${value} parameters (max recommended: ${check.threshold})`;
    case "options-object-width":
      return `Options object has ${value} keys (max recommended: ${check.threshold})`;
    case "relative-import-depth":
      return `Relative import depth ${value} levels (max recommended: ${check.threshold})`;
    case "try-catch-count":
      return `${value} try-catch blocks (see CODINGSTANDARDS/general.md §Result)`;
    case "contract-pattern":
      return `Contract missing HookContract export (see CODINGSTANDARDS/hooks.md §Contract)`;
    case "adapter-bypass":
      return `${value} raw I/O imports in contract (see CODINGSTANDARDS/hooks.md §Adapters)`;
    case "throw-count":
      return `${value} throw statements (return Result instead of throwing)`;
    case "null-return-count":
      return `${value} null/undefined returns (use Result or Option type instead)`;
    case "mixed-error-strategy":
      return "File mixes Result types with try-catch/throw (pick one error strategy)";
    default:
      return `${check.name}: ${value} (threshold: ${check.threshold})`;
  }
}

/**
 * Format violations as a concise advisory string for hook context injection.
 */
export function formatAdvisory(result: QualityScore, filePath: string): string | null {
  if (result.violations.length === 0) return null;

  const fileName = filePath.split("/").pop() ?? filePath;
  const lines = [`SOLID quality: ${result.score}/10 for ${fileName}`];

  for (const v of result.violations) {
    const icon = v.severity === "major" ? "!!" : v.severity === "moderate" ? "!" : "~";
    lines.push(`  ${icon} [${v.category}] ${v.message}`);
  }

  return lines.join("\n");
}

/**
 * Format a quality delta comparison as an advisory string.
 */
export function formatDelta(
  before: QualityScore,
  after: QualityScore,
  filePath: string,
): string | null {
  const delta = after.score - before.score;
  if (Math.abs(delta) < 0.1) return null;

  const fileName = filePath.split("/").pop() ?? filePath;
  const direction = delta > 0 ? "improved" : "degraded";
  const sign = delta > 0 ? "+" : "";

  return `SOLID quality ${direction}: ${before.score} -> ${after.score} (${sign}${delta.toFixed(1)}) for ${fileName}`;
}
