#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CitationTracker } from "@hooks/hooks/ObligationStateMachines/CitationTracker/CitationTracker.contract";

if (import.meta.main) {
  runHook(CitationTracker).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
