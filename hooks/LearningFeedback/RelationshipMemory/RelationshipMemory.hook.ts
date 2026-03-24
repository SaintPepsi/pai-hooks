#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { RelationshipMemory } from "@hooks/hooks/LearningFeedback/RelationshipMemory/RelationshipMemory.contract";

if (import.meta.main) {
  runHook(RelationshipMemory).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
