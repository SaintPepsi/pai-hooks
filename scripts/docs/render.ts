#!/usr/bin/env bun
/**
 * docs:render — Generate HTML documentation from hook doc.md files.
 *
 * Walks hooks/ → reads group.json + hook.json + doc.md → outputs HTML to docs/.
 *
 * Usage: bun run scripts/docs/render.ts [--out <dir>] [--doc-name <filename>]
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { renderHookPage, renderGroupPage, renderIndexPage } from "./template";
import type { HookMeta, GroupMeta } from "./template";

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const rootDir = resolve(import.meta.dir, "../..");
const hooksDir = join(rootDir, "hooks");

function getArg(flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const outDir = resolve(getArg("--out", join(rootDir, "docs")));
const docFileName = getArg("--doc-name", "doc.md");

// ─── Scan ─────────────────────────────────────────────────────────────────────

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

interface RawGroupJson {
  name: string;
  description?: string;
  hooks: string[];
}

interface RawHookJson {
  name: string;
  group: string;
  event: string;
  description?: string;
}

const groups: GroupMeta[] = [];
let generated = 0;
let skipped = 0;

const groupDirs = readdirSync(hooksDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const groupName of groupDirs) {
  const groupDir = join(hooksDir, groupName);
  const groupJson = readJsonFile<RawGroupJson>(join(groupDir, "group.json"));
  if (!groupJson) continue;

  const hookMetas: HookMeta[] = [];

  for (const hookName of groupJson.hooks) {
    const hookDir = join(groupDir, hookName);
    const hookJson = readJsonFile<RawHookJson>(join(hookDir, "hook.json"));
    if (!hookJson) continue;

    hookMetas.push({
      name: hookJson.name,
      group: groupName,
      event: hookJson.event,
      description: hookJson.description ?? "",
    });
  }

  groups.push({
    name: groupJson.name,
    description: groupJson.description ?? "",
    hooks: hookMetas,
  });
}

// ─── Generate ─────────────────────────────────────────────────────────────────

// Top-level index
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "index.html"), renderIndexPage(groups));

for (const group of groups) {
  const groupOutDir = join(outDir, "groups", group.name);
  mkdirSync(groupOutDir, { recursive: true });

  // Group index
  writeFileSync(join(groupOutDir, "index.html"), renderGroupPage(group));

  // Individual hook pages
  for (const hook of group.hooks) {
    const docPath = join(hooksDir, group.name, hook.name, docFileName);

    if (!existsSync(docPath)) {
      skipped++;
      continue;
    }

    const markdown = readFileSync(docPath, "utf-8");
    const html = renderHookPage(hook, markdown, group.name);
    writeFileSync(join(groupOutDir, `${hook.name}.html`), html);
    generated++;
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

const total = groups.reduce((n, g) => n + g.hooks.length, 0);
process.stdout.write(`docs:render complete\n`);
process.stdout.write(`  ${groups.length} groups, ${total} hooks total\n`);
process.stdout.write(`  ${generated} pages generated, ${skipped} skipped (no ${docFileName})\n`);
process.stdout.write(`  Output: ${outDir}\n`);
