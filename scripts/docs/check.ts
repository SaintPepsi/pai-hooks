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

import { readdirSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const rootDir = resolve(import.meta.dir, "../..");
const hooksDir = join(rootDir, "hooks");

function getArg(flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const docFileName = getArg("--doc-name", "doc.md");

// ─── Default Required Sections ────────────────────────────────────────────────

const REQUIRED_SECTIONS = [
  "## Overview",
  "## Event",
  "## When It Fires",
  "## What It Does",
  "## Examples",
  "## Dependencies",
];

// Try to read from settings.json
function loadRequiredSections(): string[] {
  const home = process.env.HOME ?? "";
  const paiDir = process.env.PAI_DIR ?? join(home, ".claude");
  const settingsPath = join(paiDir, "settings.json");

  if (!existsSync(settingsPath)) return REQUIRED_SECTIONS;

  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const sections = settings?.hookConfig?.hookDocEnforcer?.requiredSections;
    if (Array.isArray(sections)) return sections;
  } catch { /* use defaults */ }

  return REQUIRED_SECTIONS;
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

const groupDirs = readdirSync(hooksDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const groupName of groupDirs) {
  const groupDir = join(hooksDir, groupName);
  const groupJsonPath = join(groupDir, "group.json");
  if (!existsSync(groupJsonPath)) continue;

  const groupJson = JSON.parse(readFileSync(groupJsonPath, "utf-8")) as RawGroupJson;

  for (const hookName of groupJson.hooks) {
    total++;
    const docPath = join(groupDir, hookName, docFileName);

    if (!existsSync(docPath)) {
      issues.push({ hook: hookName, group: groupName, type: "missing" });
      continue;
    }

    const content = readFileSync(docPath, "utf-8");
    const missing = requiredSections.filter((s) => !content.includes(s));

    if (missing.length > 0) {
      issues.push({ hook: hookName, group: groupName, type: "incomplete", missingSections: missing });
    }
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

const valid = total - issues.length;
process.stdout.write(`docs:check — ${valid}/${total} hooks have valid ${docFileName}\n\n`);

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
    for (const s of i.missingSections!) {
      process.stdout.write(`      missing: ${s}\n`);
    }
  }
}

process.exit(1);
