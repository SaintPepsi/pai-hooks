#!/usr/bin/env bun
/**
 * SkillGuard.hook.ts — Thin shim (SOLID+ROP migration)
 *
 * All business logic lives in contracts/SkillGuard.ts.
 * This file is the hook entry point that settings.json references.
 */

import { runHook } from "@hooks/core/runner";
import { SkillGuard } from "@hooks/hooks/SkillGuard/SkillGuard/SkillGuard.contract";

if (import.meta.main) {
  runHook(SkillGuard).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
