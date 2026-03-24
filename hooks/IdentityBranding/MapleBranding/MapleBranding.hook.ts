#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { MapleBranding } from "@hooks/hooks/IdentityBranding/MapleBranding/MapleBranding.contract";

if (import.meta.main) {
  runHook(MapleBranding).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
