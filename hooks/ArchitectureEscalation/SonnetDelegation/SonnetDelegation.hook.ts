#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SonnetDelegation } from "@hooks/hooks/ArchitectureEscalation/SonnetDelegation/SonnetDelegation.contract";

if (import.meta.main) {
  runHook(SonnetDelegation).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
