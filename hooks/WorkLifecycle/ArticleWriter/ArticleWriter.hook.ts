#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ArticleWriter } from "@hooks/hooks/WorkLifecycle/ArticleWriter/ArticleWriter.contract";

if (import.meta.main) {
  runHook(ArticleWriter).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
