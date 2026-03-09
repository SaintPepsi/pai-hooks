#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { ArchitectureEscalation } from "./contracts/ArchitectureEscalation";

if (import.meta.main) {
  runHook(ArchitectureEscalation).catch(() => {

    process.exit(0);
  });
}
