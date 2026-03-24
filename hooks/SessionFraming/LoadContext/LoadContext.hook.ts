#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { LoadContext } from "@hooks/contracts/LoadContext";

if (import.meta.main) {
  runHook(LoadContext).catch(() => {
    process.exit(0);
  });
}
