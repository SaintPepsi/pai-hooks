#!/usr/bin/env bun
/**
 * AgentLifecycleStart.hook.ts — Thin shim
 *
 * All business logic lives in contracts/AgentLifecycle.ts.
 * Creates per-agent lifecycle file when a subagent spawns.
 */

import { runHook } from "@hooks/core/runner";
import { AgentLifecycleStart } from "@hooks/contracts/AgentLifecycle";

if (import.meta.main) {
  runHook(AgentLifecycleStart).catch(() => {
    process.exit(0);
  });
}
