#!/usr/bin/env bun
/**
 * AgentExecutionGuard.hook.ts — Thin shim (SOLID+ROP migration)
 *
 * All business logic lives in contracts/AgentExecutionGuard.ts.
 * This file is the hook entry point that settings.json references.
 */

import { runHook } from "@hooks/core/runner";
import { AgentExecutionGuard } from "@hooks/contracts/AgentExecutionGuard";

if (import.meta.main) {
  runHook(AgentExecutionGuard).catch(() => {

    process.exit(0);
  });
}
