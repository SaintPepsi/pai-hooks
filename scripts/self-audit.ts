/**
 * Self-Audit Script — Run guard hooks against our own source files.
 *
 * Imports the pure analysis functions from our guard hooks and runs them
 * against every non-test source file in the codebase. Writes a markdown
 * report to MEMORY/LEARNING/QUALITY/.
 *
 * Usage: bun scripts/self-audit.ts
 */

import { join, relative } from "node:path";
import { ensureDir, readDir, readFile, writeFile } from "@hooks/core/adapters/fs";
import { getLanguageProfile, isScorableFile } from "@hooks/core/language-profiles";
import { type QualityScore, scoreFile } from "@hooks/core/quality-scorer";
import { findAnyViolations } from "@hooks/hooks/CodingStandards/TypeStrictness/TypeStrictness.contract";
import { findAllViolations, type Violation } from "@hooks/lib/coding-standards-checks";

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE_DIR = import.meta.dir.replace(/\/scripts$/, "");
const REPORT_DIR = join(BASE_DIR, "..", "MEMORY", "LEARNING", "QUALITY");

const TARGET_DIRS = [join(BASE_DIR, "contracts"), join(BASE_DIR, "lib"), join(BASE_DIR, "core")];

const EXCLUDE_PATTERNS = [
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /\.coverage\.test\.ts$/,
  /\.integration\.test\.ts$/,
  /\/adapters\//, // Adapters legitimately wrap builtins
  /\/node_modules\//,
];

// ─── File Discovery ─────────────────────────────────────────────────────────

function walkDir(dir: string, files: string[]): void {
  const result = readDir(dir, { withFileTypes: true });
  if (!result.ok) return; // dir doesn't exist or unreadable — skip silently

  for (const entry of result.value) {
    const name = (entry as { name: string }).name;
    const fullPath = join(dir, name);
    if ((entry as { isDirectory(): boolean }).isDirectory()) {
      walkDir(fullPath, files);
    } else if (name.endsWith(".ts")) {
      const excluded = EXCLUDE_PATTERNS.some((p) => p.test(fullPath));
      if (!excluded) {
        files.push(fullPath);
      }
    }
  }
}

function discoverFiles(dirs: string[]): string[] {
  const files: string[] = [];
  for (const dir of dirs) {
    walkDir(dir, files);
  }
  return files.sort();
}

// ─── Analysis Types ─────────────────────────────────────────────────────────

interface AnyViolation {
  line: number;
  content: string;
  pattern: string;
}

interface FileAudit {
  path: string;
  relativePath: string;
  codingStandards: Violation[];
  typeStrictness: { violations: AnyViolation[] };
  qualityScore: QualityScore | null;
}

interface AuditSummary {
  totalFiles: number;
  filesWithViolations: number;
  cleanFiles: number;
  violationsByCategory: Record<string, number>;
  anyTypeViolations: number;
  averageQualityScore: number;
  lowestScoring: { path: string; score: number }[];
  highestScoring: { path: string; score: number }[];
}

// ─── Analysis Engine ────────────────────────────────────────────────────────

function analyzeFile(filePath: string): FileAudit {
  const fileResult = readFile(filePath);
  const content = fileResult.ok ? fileResult.value : "";
  const relativePath = relative(BASE_DIR, filePath);

  const codingStandards = findAllViolations(content);
  const anyViolations = findAnyViolations(content);

  let qualityScore: QualityScore | null = null;
  if (isScorableFile(filePath)) {
    const profile = getLanguageProfile(filePath);
    if (profile) {
      qualityScore = scoreFile(content, profile, filePath);
    }
  }

  return {
    path: filePath,
    relativePath,
    codingStandards,
    typeStrictness: { violations: anyViolations as AnyViolation[] },
    qualityScore,
  };
}

function summarize(audits: FileAudit[]): AuditSummary {
  const violationsByCategory: Record<string, number> = {};
  let filesWithViolations = 0;
  let anyTypeTotal = 0;
  const scores: { path: string; score: number }[] = [];

  for (const audit of audits) {
    const hasIssues =
      audit.codingStandards.length > 0 || audit.typeStrictness.violations.length > 0;

    if (hasIssues) filesWithViolations++;

    for (const v of audit.codingStandards) {
      violationsByCategory[v.category] = (violationsByCategory[v.category] || 0) + 1;
    }

    anyTypeTotal += audit.typeStrictness.violations.length;

    if (audit.qualityScore) {
      scores.push({
        path: audit.relativePath,
        score: audit.qualityScore.score,
      });
    }
  }

  scores.sort((a, b) => a.score - b.score);
  const avgScore =
    scores.length > 0 ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length : 0;

  return {
    totalFiles: audits.length,
    filesWithViolations,
    cleanFiles: audits.length - filesWithViolations,
    violationsByCategory,
    anyTypeViolations: anyTypeTotal,
    averageQualityScore: Math.round(avgScore * 10) / 10,
    lowestScoring: scores.slice(0, 5),
    highestScoring: scores.slice(-5).reverse(),
  };
}

// ─── Report Generator ───────────────────────────────────────────────────────

function generateReport(audits: FileAudit[], summary: AuditSummary): string {
  const timestamp = new Date().toISOString();
  const lines: string[] = [];

  lines.push("# PAI Hooks Self-Audit Report");
  lines.push("");
  lines.push(`**Generated:** ${timestamp}`);
  lines.push(`**Files Scanned:** ${summary.totalFiles}`);
  lines.push(`**Files with Violations:** ${summary.filesWithViolations}`);
  lines.push(`**Clean Files:** ${summary.cleanFiles}`);
  lines.push(`**Average Quality Score:** ${summary.averageQualityScore}/10`);
  lines.push("");

  lines.push("## Violation Summary by Category");
  lines.push("");
  lines.push("| Category | Count |");
  lines.push("|----------|-------|");
  for (const [category, count] of Object.entries(summary.violationsByCategory).sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`| ${category} | ${count} |`);
  }
  if (summary.anyTypeViolations > 0) {
    lines.push(`| any-type (TypeStrictness) | ${summary.anyTypeViolations} |`);
  }
  lines.push("");

  lines.push("## Quality Scores");
  lines.push("");
  if (summary.lowestScoring.length > 0) {
    lines.push("### Lowest Scoring Files");
    lines.push("");
    lines.push("| File | Score |");
    lines.push("|------|-------|");
    for (const f of summary.lowestScoring) {
      lines.push(`| ${f.path} | ${f.score}/10 |`);
    }
    lines.push("");
  }
  if (summary.highestScoring.length > 0) {
    lines.push("### Highest Scoring Files");
    lines.push("");
    lines.push("| File | Score |");
    lines.push("|------|-------|");
    for (const f of summary.highestScoring) {
      lines.push(`| ${f.path} | ${f.score}/10 |`);
    }
    lines.push("");
  }

  lines.push("## Per-File Detail");
  lines.push("");

  for (const audit of audits) {
    const csCount = audit.codingStandards.length;
    const tsCount = audit.typeStrictness.violations.length;
    const score = audit.qualityScore?.score ?? "N/A";
    const totalIssues = csCount + tsCount;

    const icon = totalIssues === 0 ? "✅" : "⚠️";
    lines.push(`### ${icon} ${audit.relativePath}`);
    lines.push("");
    lines.push(`- **Quality Score:** ${score}/10`);
    lines.push(`- **Coding Standards Violations:** ${csCount}`);
    lines.push(`- **Type Strictness Violations:** ${tsCount}`);

    if (csCount > 0) {
      lines.push("");
      lines.push("**Coding Standards:**");
      for (const v of audit.codingStandards) {
        lines.push(`- Line ${v.line} [${v.category}]: ${v.content}`);
      }
    }

    if (tsCount > 0) {
      lines.push("");
      lines.push("**Type Strictness:**");
      for (const v of audit.typeStrictness.violations) {
        lines.push(`- Line ${v.line} [${v.pattern}]: ${v.content}`);
      }
    }

    if (audit.qualityScore && audit.qualityScore.violations.length > 0) {
      lines.push("");
      lines.push("**SOLID Violations:**");
      for (const v of audit.qualityScore.violations) {
        lines.push(`- [${v.category}/${v.severity}] ${v.check}: ${v.message}`);
      }
    }

    lines.push("");
  }

  lines.push("## Patterns & Learnings");
  lines.push("");

  const cats = Object.entries(summary.violationsByCategory).sort((a, b) => b[1] - a[1]);
  if (cats.length > 0) {
    lines.push(`**Most common violation:** ${cats[0][0]} (${cats[0][1]} instances)`);
    lines.push("");
    lines.push("**Key observations:**");
    lines.push("");

    if (summary.violationsByCategory["relative-import"]) {
      lines.push(
        `- **Relative imports** are the dominant issue (${summary.violationsByCategory["relative-import"]} instances). These files predate the @hooks/ path alias and were never migrated.`,
      );
    }
    if (summary.violationsByCategory["try-catch"]) {
      lines.push(
        `- **Try-catch flow control** appears in ${summary.violationsByCategory["try-catch"]} files. These need Result<T, E> pipeline refactoring.`,
      );
    }
    if (summary.violationsByCategory["process-env"]) {
      lines.push(
        `- **Direct process.env** access in ${summary.violationsByCategory["process-env"]} locations. Most are module-level BASE_DIR consts that feed defaultDeps -- structurally borderline.`,
      );
    }
    if (summary.violationsByCategory["raw-import"]) {
      lines.push(
        `- **Raw Node builtins** in ${summary.violationsByCategory["raw-import"]} locations (likely homedir from "os").`,
      );
    }
    if (summary.anyTypeViolations > 0) {
      lines.push(
        `- **any types** in ${summary.anyTypeViolations} locations. These need proper typing or unknown.`,
      );
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("*Auto-generated by scripts/self-audit.ts*");

  return lines.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  console.log("PAI Hooks Self-Audit");
  console.log("====================\n");

  const files = discoverFiles(TARGET_DIRS);
  console.log(`Found ${files.length} source files to audit.\n`);

  const audits = files.map((f) => {
    const audit = analyzeFile(f);
    const issues = audit.codingStandards.length + audit.typeStrictness.violations.length;
    const icon = issues === 0 ? "OK" : "WARN";
    console.log(
      `[${icon}] ${audit.relativePath}: ${issues} violations, score ${audit.qualityScore?.score ?? "N/A"}/10`,
    );
    return audit;
  });

  console.log("");

  const summary = summarize(audits);
  const report = generateReport(audits, summary);

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const yearMonth = dateStr.substring(0, 7);
  const reportDir = join(REPORT_DIR, yearMonth);
  ensureDir(reportDir);
  const reportPath = join(reportDir, `self-audit-${dateStr}.md`);
  writeFile(reportPath, report);

  console.log(`\nReport written to: ${reportPath}`);
  console.log(`\nSummary:`);
  console.log(`   Files scanned: ${summary.totalFiles}`);
  console.log(`   With violations: ${summary.filesWithViolations}`);
  console.log(`   Clean: ${summary.cleanFiles}`);
  console.log(`   Avg quality: ${summary.averageQualityScore}/10`);
  console.log(
    `   Top violation: ${Object.entries(summary.violationsByCategory).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none"}`,
  );
}

main();
