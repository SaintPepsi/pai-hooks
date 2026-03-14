#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { GitignoreRecommender } from "@hooks/contracts/GitignoreRecommender";

if (import.meta.main) {
  runHook(GitignoreRecommender).catch(() => {
    process.exit(0);
  });
}
