#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { LoadContext } from "./contracts/LoadContext";

if (import.meta.main) {
  runHook(LoadContext).catch(() => {
    process.exit(0);
  });
}
