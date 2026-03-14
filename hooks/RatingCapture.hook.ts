#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { RatingCapture } from "@hooks/contracts/RatingCapture";

if (import.meta.main) {
  runHook(RatingCapture).catch(() => {
    process.exit(0);
  });
}
