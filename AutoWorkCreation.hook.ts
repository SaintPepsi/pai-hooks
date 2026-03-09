#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { AutoWorkCreation } from "./contracts/AutoWorkCreation";

if (import.meta.main) {
  runHook(AutoWorkCreation).catch(() => {
    process.exit(0);
  });
}
