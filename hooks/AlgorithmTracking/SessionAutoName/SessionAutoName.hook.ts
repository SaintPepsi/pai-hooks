#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SessionAutoName } from "@hooks/hooks/AlgorithmTracking/SessionAutoName/SessionAutoName.contract";

if (import.meta.main) {
  runHook(SessionAutoName).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
