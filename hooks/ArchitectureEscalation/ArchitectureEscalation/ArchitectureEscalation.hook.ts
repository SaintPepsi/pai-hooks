#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ArchitectureEscalation } from "@hooks/hooks/ArchitectureEscalation/ArchitectureEscalation/ArchitectureEscalation.contract";

if (import.meta.main) {
  runHook(ArchitectureEscalation).catch(() => {

    process.exit(0);
  });
}
