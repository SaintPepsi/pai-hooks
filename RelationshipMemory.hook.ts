#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { RelationshipMemory } from "./contracts/RelationshipMemory";

if (import.meta.main) {
  runHook(RelationshipMemory).catch(() => {
    process.exit(0);
  });
}
