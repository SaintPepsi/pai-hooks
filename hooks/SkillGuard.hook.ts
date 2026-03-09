#!/usr/bin/env bun
/**
 * SkillGuard.hook.ts — Thin shim (SOLID+ROP migration)
 *
 * All business logic lives in contracts/SkillGuard.ts.
 * This file is the hook entry point that settings.json references.
 */

import { runHook } from "./core/runner";
import { SkillGuard } from "./contracts/SkillGuard";

if (import.meta.main) {
  runHook(SkillGuard).catch(() => {

    process.exit(0);
  });
}
