#!/usr/bin/env bun
/**
 * docs:check — Verify all hooks have doc.md files with required sections.
 *
 * Reads hookConfig.hookDocEnforcer settings for required sections,
 * then checks every hook directory for a conforming doc file.
 *
 * Exit code 0 = all docs present and valid.
 * Exit code 1 = missing or incomplete docs found.
 *
 * Usage: bun run scripts/docs/check.ts [--doc-name <filename>]
 */

import {
  fileExists,
  readDir,
  readFile,
  readJson,
} from "@hooks/core/adapters/fs";
import { tryCatch } from "@hooks/core/result";
import { join, resolve } from "node:path";
import { getArg } from "@hooks/scripts/docs/cli-utils";

// ─── Deps ────────────────────────────────────────────────────────────────────

interface CheckDeps {
  home: string;
  paiDir: string;
}

const defaultDeps: CheckDeps = {
  home: process.env.HOME ?? "",
  paiDir: process.env.PAI_DIR ?? join(process.env.HOME ?? "", ".claude"),
};

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const rootDir = resolve(import.meta.dir, "../..");
const hooksDir = join(rootDir, "hooks");

const docFileName = getArg(args, "--doc-name", "doc.md");

// ─── Default Required Sections ────────────────────────────────────────────────

const REQUIRED_SECTIONS = [
  "## Overview",
  "## Event",
  "## When It Fires",
  "## What It Does",
  "## Examples",
  "## Dependencies",
];

function loadRequiredSections(deps: CheckDeps = defaultDeps): string[] {
  const settingsPath = join(deps.paiDir, "settings.json");

  if (!fileExists(settingsPath)) return REQUIRED_SECTIONS;

  const result = readJson<{
    hookConfig?: { hookDocEnforcer?: { requiredSections?: string[] } };
  }>(settingsPath);
  if (!result.ok) return REQUIRED_SECTIONS;

  const sections = result.value?.hookConfig?.hookDocEnforcer?.requiredSections;
  return Array.isArray(sections) ? sections : REQUIRED_SECTIONS;
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

interface RawGroupJson {
  name: string;
  hooks: string[];
}

interface Issue {
  hook: string;
  group: string;
  type: "missing" | "incomplete";
  missingSections?: string[];
}

const requiredSections = loadRequiredSections();
const issues: Issue[] = [];
let total = 0;

const groupDirsResult = readDir(hooksDir);
const groupDirs = groupDirsResult.ok ? groupDirsResult.value.sort() : [];

for (const groupName of groupDirs) {
  const groupDir = join(hooksDir, groupName);
  const groupJsonPath = join(groupDir, "group.json");
  if (!fileExists(groupJsonPath)) continue;

  const groupResult = readJson<RawGroupJson>(groupJsonPath);
  if (!groupResult.ok) continue;
  const groupJson = groupResult.value;

  for (const hookName of groupJson.hooks) {
    total++;
    const docPath = join(groupDir, hookName, docFileName);

    if (!fileExists(docPath)) {
      issues.push({ hook: hookName, group: groupName, type: "missing" });
      continue;
    }

    const contentResult = readFile(docPath);
    if (!contentResult.ok) continue;
    const missing = requiredSections.filter(
      (s) => !contentResult.value.includes(s),
    );

    if (missing.length > 0) {
      issues.push({
        hook: hookName,
        group: groupName,
        type: "incomplete",
        missingSections: missing,
      });
    }
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

const valid = total - issues.length;
process.stdout.write(
  `docs:check — ${valid}/${total} hooks have valid ${docFileName}\n\n`,
);

if (issues.length === 0) {
  process.stdout.write("All hooks documented.\n");
  process.exit(0);
}

const missingDocs = issues.filter((i) => i.type === "missing");
const incompleteDocs = issues.filter((i) => i.type === "incomplete");

if (missingDocs.length > 0) {
  process.stdout.write(`Missing ${docFileName}:\n`);
  for (const i of missingDocs) {
    process.stdout.write(`  - ${i.group}/${i.hook}\n`);
  }
  process.stdout.write("\n");
}

if (incompleteDocs.length > 0) {
  process.stdout.write(`Incomplete ${docFileName}:\n`);
  for (const i of incompleteDocs) {
    process.stdout.write(`  - ${i.group}/${i.hook}\n`);
  }
}

process.exit(1);
