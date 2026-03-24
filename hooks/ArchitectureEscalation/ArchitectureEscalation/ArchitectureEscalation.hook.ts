#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ArchitectureEscalation } from "@hooks/hooks/ArchitectureEscalation/ArchitectureEscalation/ArchitectureEscalation.contract";

if (import.meta.main) {
  runHook(ArchitectureEscalation).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
