#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ArchitectureEscalation } from "@hooks/contracts/ArchitectureEscalation";

if (import.meta.main) {
  runHook(ArchitectureEscalation).catch(() => {

    process.exit(0);
  });
}
