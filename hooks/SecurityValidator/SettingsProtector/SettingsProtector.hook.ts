#!/usr/bin/env bun
/**
 * SettingsProtector.hook.ts — Thin shim
 *
 * All business logic lives in SettingsProtector.contract.ts.
 * This file is the hook entry point that settings.json references.
 */

import { runHook } from "@hooks/core/runner";
import { SettingsProtector } from "@hooks/hooks/SecurityValidator/SettingsProtector/SettingsProtector.contract";

if (import.meta.main) {
  runHook(SettingsProtector).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
