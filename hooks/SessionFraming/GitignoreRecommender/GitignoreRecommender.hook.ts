#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { GitignoreRecommender } from "@hooks/hooks/SessionFraming/GitignoreRecommender/GitignoreRecommender.contract";

if (import.meta.main) {
  runHook(GitignoreRecommender).catch(() => {
    process.exit(0);
  });
}
