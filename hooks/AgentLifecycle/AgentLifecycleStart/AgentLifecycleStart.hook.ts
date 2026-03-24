#!/usr/bin/env bun
/**
 * AgentLifecycleStart.hook.ts — Thin shim
 *
 * All business logic lives in hooks/AgentLifecycle/AgentLifecycleStart/AgentLifecycleStart.contract.ts.
 * Creates per-agent lifecycle file when a subagent spawns.
 */

import { runHook } from "@hooks/core/runner";
import { AgentLifecycleStart } from "@hooks/hooks/AgentLifecycle/AgentLifecycleStart/AgentLifecycleStart.contract";

if (import.meta.main) {
  runHook(AgentLifecycleStart).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
