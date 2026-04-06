#!/usr/bin/env bun
/**
 * Pre-commit doc gate — blocks commit if any hook is missing doc.md or rendered HTML.
 *
 * Mirrors the logic previously inline in .husky/pre-commit:
 *   1. Every hooks/{Group}/{Hook}/hook.json directory must have a doc.md
 *   2. Every hook must have a docs/groups/{Group}/{Hook}.html
 *
 * Exit 0 = all docs present. Exit 1 = missing docs or HTML.
 */

import { dirname, basename, join, resolve } from "node:path";
import { fileExists } from "@hooks/core/adapters/fs";
import { Glob } from "bun";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GateIssue {
  hookDir: string;
  hookName: string;
  groupName: string;
  type: "missing-doc" | "missing-idea" | "missing-html";
}

export interface GateDeps {
  fileExists: (path: string) => boolean;
  scanHookJsons: (hooksDir: string) => Iterable<string>;
}

export interface GateConfig {
  hooksDir: string;
  docsDir: string;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: GateDeps = {
  fileExists,
  scanHookJsons: (hooksDir: string) => {
    const glob = new Glob("*/*/hook.json");
    return glob.scanSync({ cwd: hooksDir });
  },
};

// ─── Core Logic ──────────────────────────────────────────────────────────────

export function checkDocGate(
  config: GateConfig,
  deps: GateDeps = defaultDeps,
): GateIssue[] {
  const issues: GateIssue[] = [];

  for (const match of deps.scanHookJsons(config.hooksDir)) {
    const hookJsonPath = join(config.hooksDir, match);
    const hookDir = dirname(hookJsonPath);
    const hookName = basename(hookDir);
    const groupName = basename(dirname(hookDir));

    if (!deps.fileExists(join(hookDir, "doc.md"))) {
      issues.push({ hookDir, hookName, groupName, type: "missing-doc" });
    }

    if (!deps.fileExists(join(hookDir, "IDEA.md"))) {
      issues.push({ hookDir, hookName, groupName, type: "missing-idea" });
    }

    if (!deps.fileExists(join(config.docsDir, groupName, `${hookName}.html`))) {
      issues.push({ hookDir, hookName, groupName, type: "missing-html" });
    }
  }

  return issues;
}

// ─── Report ──────────────────────────────────────────────────────────────────

export function formatReport(issues: GateIssue[]): string {
  if (issues.length === 0) return "";

  const lines: string[] = [];
  const missingDocs = issues.filter((i) => i.type === "missing-doc");
  const missingIdea = issues.filter((i) => i.type === "missing-idea");
  const missingHtml = issues.filter((i) => i.type === "missing-html");

  for (const i of missingDocs) {
    lines.push(`ERROR: Missing doc.md in ${i.hookDir}/`);
  }

  for (const i of missingIdea) {
    lines.push(`ERROR: Missing IDEA.md in ${i.hookDir}/`);
  }

  for (const i of missingHtml) {
    lines.push(
      `ERROR: Missing docs/groups/${i.groupName}/${i.hookName}.html\n  Run: bun run docs:render`,
    );
  }

  lines.push(
    "\nPre-commit blocked: hook documentation incomplete.\n  - Add doc.md to hook directories that need it\n  - Add IDEA.md to hook directories that need it\n  - Run 'bun run docs:render' to generate HTML",
  );

  return lines.join("\n");
}

// ─── CLI Entry ───────────────────────────────────────────────────────────────

function main(): void {
  const rootDir = resolve(import.meta.dir, "../..");
  const config: GateConfig = {
    hooksDir: join(rootDir, "hooks"),
    docsDir: join(rootDir, "docs", "groups"),
  };

  const issues = checkDocGate(config);

  if (issues.length === 0) {
    process.exit(0);
  }

  process.stderr.write(`${formatReport(issues)}\n`);
  process.exit(1);
}

// Only run when executed directly, not when imported for tests
if (import.meta.main) {
  main();
}
