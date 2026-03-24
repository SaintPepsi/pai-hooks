#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { RatingCapture } from "@hooks/hooks/LearningFeedback/RatingCapture/RatingCapture.contract";

if (import.meta.main) {
  runHook(RatingCapture).catch(() => {
    process.exit(0);
  });
}
