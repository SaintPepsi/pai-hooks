#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { RelationshipMemory } from "@hooks/hooks/LearningFeedback/RelationshipMemory/RelationshipMemory.contract";

if (import.meta.main) {
  runHook(RelationshipMemory).catch(() => {
    process.exit(0);
  });
}
