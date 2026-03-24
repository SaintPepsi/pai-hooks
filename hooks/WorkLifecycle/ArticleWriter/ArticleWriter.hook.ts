#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ArticleWriter } from "@hooks/hooks/WorkLifecycle/ArticleWriter/ArticleWriter.contract";

if (import.meta.main) {
  runHook(ArticleWriter).catch(() => {
    process.exit(0);
  });
}
