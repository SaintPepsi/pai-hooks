#!/usr/bin/env bun
/**
 * AgentTrackerPre.hook.ts — Thin shim
 *
 * All business logic lives in contracts/AgentTracker.ts.
 * Increments active agent count when Agent (Task) tool fires.
 */

import { runHook } from "@hooks/core/runner";
import { AgentTrackerPre } from "@hooks/contracts/AgentTracker";

if (import.meta.main) {
  runHook(AgentTrackerPre).catch(() => {
    process.exit(0);
  });
}
