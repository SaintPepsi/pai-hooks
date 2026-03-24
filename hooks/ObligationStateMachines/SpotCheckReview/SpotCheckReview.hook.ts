#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SpotCheckReview } from "@hooks/hooks/ObligationStateMachines/SpotCheckReview/SpotCheckReview.contract";

if (import.meta.main) {
  runHook(SpotCheckReview).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
