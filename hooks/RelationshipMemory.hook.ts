#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { RelationshipMemory } from "@hooks/contracts/RelationshipMemory";

if (import.meta.main) {
  runHook(RelationshipMemory).catch(() => {
    process.exit(0);
  });
}
