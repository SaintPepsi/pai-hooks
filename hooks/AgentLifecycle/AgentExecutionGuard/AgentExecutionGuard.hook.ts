#!/usr/bin/env bun
/**
 * AgentExecutionGuard.hook.ts — Thin shim
 *
 * All business logic lives in hooks/AgentLifecycle/AgentExecutionGuard/AgentExecutionGuard.contract.ts.
 * This file is the hook entry point that settings.hooks.json references.
 */

import { runHook } from "@hooks/core/runner";
import { AgentExecutionGuard } from "./AgentExecutionGuard.contract";

if (import.meta.main) {
  runHook(AgentExecutionGuard).catch(() => {

    process.exit(0);
  });
}
