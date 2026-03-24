#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { MapleBranding } from "@hooks/contracts/MapleBranding";

if (import.meta.main) {
  runHook(MapleBranding).catch(() => {
    process.exit(0);
  });
}
