#!/usr/bin/env bun
/**
 * SettingsProtectorPost.hook.ts — Thin shim
 *
 * All business logic lives in SettingsProtectorPost.contract.ts.
 * This file is the hook entry point that settings.json references.
 */

import { runHook } from "@hooks/core/runner";
import { SettingsProtectorPost } from "@hooks/hooks/SecurityValidator/SettingsProtectorPost/SettingsProtectorPost.contract";

if (import.meta.main) {
  runHook(SettingsProtectorPost).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
