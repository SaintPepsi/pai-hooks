#!/usr/bin/env bun
/**
 * QuestionAnswered.hook.ts — Thin shim (SOLID+ROP migration)
 *
 * All business logic lives in contracts/QuestionAnswered.ts.
 * This file is the hook entry point that settings.json references.
 */

import { runHook } from "@hooks/core/runner";
import { QuestionAnswered } from "@hooks/hooks/QuestionAnswered/QuestionAnswered/QuestionAnswered.contract";

if (import.meta.main) {
  runHook(QuestionAnswered).catch(() => {
    process.exit(0);
  });
}
