#!/usr/bin/env bun
/**
 * AgentLifecycleStop.hook.ts — Thin shim
 *
 * All business logic lives in hooks/AgentLifecycle/AgentLifecycleStop/AgentLifecycleStop.contract.ts.
 * Marks agent complete and cleans up orphaned files.
 */

import { runHook } from "@hooks/core/runner";
import { AgentLifecycleStop } from "@hooks/hooks/AgentLifecycle/AgentLifecycleStop/AgentLifecycleStop.contract";

if (import.meta.main) {
  runHook(AgentLifecycleStop).catch(() => {
    process.exit(0);
  });
}
