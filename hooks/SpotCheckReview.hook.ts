#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SpotCheckReview } from "@hooks/contracts/SpotCheckReview";

if (import.meta.main) {
  runHook(SpotCheckReview).catch(() => {
    process.exit(0);
  });
}
