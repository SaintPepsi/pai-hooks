#!/usr/bin/env bun
/**
 * QuestionAnswered.hook.ts — Thin shim (SOLID+ROP migration)
 *
 * All business logic lives in contracts/QuestionAnswered.ts.
 * This file is the hook entry point that settings.json references.
 */

import { runHook } from "./core/runner";
import { QuestionAnswered } from "./contracts/QuestionAnswered";

if (import.meta.main) {
  runHook(QuestionAnswered).catch(() => {
    process.exit(0);
  });
}
