#!/usr/bin/env bun
/**
 * Pre-commit doc regeneration — auto-renders HTML docs when doc sources change.
 *
 * Detects staged doc.md, IDEA.md, template.ts, style.css, or render.ts files
 * and regenerates the HTML documentation, re-staging the output.
 */

import { join, resolve } from "node:path";
import { execSyncSafe } from "@hooks/core/adapters/process";

export const DOC_PATTERNS = [
  /\/doc\.md$/,
  /\/IDEA\.md$/,
  /scripts\/docs\/template\.ts$/,
  /scripts\/docs\/style\.css$/,
  /scripts\/docs\/render\.ts$/,
];

export function matchesDocPattern(file: string): boolean {
  return DOC_PATTERNS.some((p) => p.test(file));
}

function main(): void {
  const rootDir = resolve(import.meta.dir, "../..");

  // Get staged files
  const result = execSyncSafe("git diff --cached --name-only", {
    cwd: rootDir,
  });
  if (!result.ok) return;

  const staged = result.value.trim().split("\n").filter(Boolean);
  const hasDocChanges = staged.some((file) => matchesDocPattern(file));

  if (!hasDocChanges) return;

  process.stderr.write(
    "[pre-commit] Doc sources changed — regenerating HTML docs...\n",
  );

  // Regenerate
  const renderScript = join(import.meta.dir, "render.ts");
  const renderResult = execSyncSafe(`bun run ${renderScript}`, {
    cwd: rootDir,
  });

  if (!renderResult.ok) {
    process.stderr.write(
      "[pre-commit] Doc regeneration failed (non-blocking)\n",
    );
    return;
  }

  // Re-stage docs/
  execSyncSafe("git add docs/", { cwd: rootDir });
  process.stderr.write("[pre-commit] HTML docs regenerated and staged.\n");
}

if (import.meta.main) {
  main();
}
