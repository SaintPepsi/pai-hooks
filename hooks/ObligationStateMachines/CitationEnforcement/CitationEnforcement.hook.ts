#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CitationEnforcement } from "@hooks/hooks/ObligationStateMachines/CitationEnforcement/CitationEnforcement.contract";

if (import.meta.main) {
  runHook(CitationEnforcement).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
