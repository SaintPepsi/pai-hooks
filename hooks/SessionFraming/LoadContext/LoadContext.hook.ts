#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { LoadContext } from "@hooks/hooks/SessionFraming/LoadContext/LoadContext.contract";

if (import.meta.main) {
  runHook(LoadContext).catch(() => {
    process.exit(0);
  });
}
