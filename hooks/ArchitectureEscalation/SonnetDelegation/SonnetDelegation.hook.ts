#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SonnetDelegation } from "@hooks/hooks/ArchitectureEscalation/SonnetDelegation/SonnetDelegation.contract";

if (import.meta.main) {
  runHook(SonnetDelegation).catch(() => {
    process.exit(0);
  });
}
