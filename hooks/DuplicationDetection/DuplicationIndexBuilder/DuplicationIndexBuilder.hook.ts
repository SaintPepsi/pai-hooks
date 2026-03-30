#!/usr/bin/env bun
import { readStdin } from "@hooks/core/adapters/stdin";
import { runHook, runHookWith } from "@hooks/core/runner";
import type { HookInput } from "@hooks/core/types/hook-inputs";
import { DuplicationIndexBuilderContract } from "@hooks/hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.contract";

if (import.meta.main) {
  const handle = async () => {
    // Read stdin once to detect event type
    const raw = await readStdin(200);
    if (!raw.ok) {
      process.exit(0);
      return;
    }

    const input = JSON.parse(raw.value) as HookInput;

    if ("tool_name" in input) {
      // PostToolUse — use standard runner (validates tool_name, handles safeExit)
      await runHook(DuplicationIndexBuilderContract, { stdinOverride: raw.value });
    } else {
      // SessionStart — use runHookWith to bypass tool_name validation in runner
      await runHookWith(DuplicationIndexBuilderContract, input);
    }
  };

  handle().catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
