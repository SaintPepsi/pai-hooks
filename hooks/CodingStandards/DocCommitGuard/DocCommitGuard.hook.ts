#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { DocCommitGuard } from "@hooks/hooks/CodingStandards/DocCommitGuard/DocCommitGuard.contract";

if (import.meta.main) {
  runHook(DocCommitGuard).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
