#!/usr/bin/env bun
/**
 * docs:render — Generate HTML documentation from hook doc.md files.
 *
 * Walks hooks/ → reads group.json + hook.json + doc.md → outputs HTML to docs/.
 *
 * Usage: bun run scripts/docs/render.ts [--out <dir>] [--doc-name <filename>]
 */

import {
  ensureDir,
  fileExists,
  readDir,
  readFile,
  readJson,
  writeFile,
} from "@hooks/core/adapters/fs";
import { join, resolve } from "node:path";
import type { GroupMeta, HookMeta } from "@hooks/scripts/docs/template";
import { renderGroupPage, renderHookPage, renderIndexPage } from "@hooks/scripts/docs/template";
import { getArg } from "@hooks/scripts/docs/cli-utils";

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const rootDir = resolve(import.meta.dir, "../..");

const hooksDir = resolve(getArg(args, "--hooks-dir", join(rootDir, "hooks")));
const outDir = resolve(getArg(args, "--out", join(rootDir, "docs")));
const docFileName = getArg(args, "--doc-name", "doc.md");

// ─── Scan ─────────────────────────────────────────────────────────────────────

interface RawGroupJson {
  name: string;
  description?: string;
  hooks: string[];
}

interface RawHookJson {
  name: string;
  group: string;
  event: string | string[];
  description?: string;
}

const groups: GroupMeta[] = [];
let generated = 0;
let skipped = 0;

const groupDirsResult = readDir(hooksDir);
const groupDirs = groupDirsResult.ok ? groupDirsResult.value.sort() : [];

for (const groupName of groupDirs) {
  const groupDir = join(hooksDir, groupName);
  const groupJson = readJson<RawGroupJson>(join(groupDir, "group.json"));
  if (!groupJson.ok) continue;

  const hookMetas: HookMeta[] = [];

  for (const hookName of groupJson.value.hooks) {
    const hookDir = join(groupDir, hookName);
    const hookJson = readJson<RawHookJson>(join(hookDir, "hook.json"));
    if (!hookJson.ok) continue;

    const docPath = join(hookDir, docFileName);
    hookMetas.push({
      name: hookJson.value.name,
      group: groupName,
      event: hookJson.value.event,
      description: hookJson.value.description ?? "",
      hasDoc: fileExists(docPath),
    });
  }

  groups.push({
    name: groupJson.value.name,
    description: groupJson.value.description ?? "",
    hooks: hookMetas,
  });
}

// ─── Generate ─────────────────────────────────────────────────────────────────

// Top-level index
ensureDir(outDir);
writeFile(join(outDir, "index.html"), renderIndexPage(groups));

for (const group of groups) {
  const groupOutDir = join(outDir, "groups", group.name);
  ensureDir(groupOutDir);

  // Group index
  writeFile(join(groupOutDir, "index.html"), renderGroupPage(group));

  // Individual hook pages
  for (const hook of group.hooks) {
    const docPath = join(hooksDir, group.name, hook.name, docFileName);

    if (!fileExists(docPath)) {
      skipped++;
      continue;
    }

    const mdResult = readFile(docPath);
    if (!mdResult.ok) {
      skipped++;
      continue;
    }

    const ideaPath = join(hooksDir, group.name, hook.name, "IDEA.md");
    const ideaResult = readFile(ideaPath);
    const ideaContent = ideaResult.ok ? ideaResult.value : undefined;

    const html = renderHookPage(hook, mdResult.value, group.name, ideaContent);
    writeFile(join(groupOutDir, `${hook.name}.html`), html);
    generated++;
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

const total = groups.reduce((n, g) => n + g.hooks.length, 0);
process.stdout.write(`docs:render complete\n`);
process.stdout.write(`  ${groups.length} groups, ${total} hooks total\n`);
process.stdout.write(`  ${generated} pages generated, ${skipped} skipped (no ${docFileName})\n`);
process.stdout.write(`  Output: ${outDir}\n`);
