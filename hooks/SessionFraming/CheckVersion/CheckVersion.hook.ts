#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CheckVersion } from "@hooks/hooks/SessionFraming/CheckVersion/CheckVersion.contract";

if (import.meta.main) {
  runHook(CheckVersion).catch(() => {
    process.exit(0);
  });
}
