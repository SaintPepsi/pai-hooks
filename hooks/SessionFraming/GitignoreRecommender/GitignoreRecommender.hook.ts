#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { GitignoreRecommender } from "@hooks/hooks/SessionFraming/GitignoreRecommender/GitignoreRecommender.contract";

if (import.meta.main) {
  runHook(GitignoreRecommender).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
