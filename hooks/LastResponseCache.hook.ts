#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { LastResponseCache } from "./contracts/LastResponseCache";

if (import.meta.main) {
  runHook(LastResponseCache).catch(() => {
    process.exit(0);
  });
}
