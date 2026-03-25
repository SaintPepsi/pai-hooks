import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { readFile } from "@hooks/core/adapters/fs";
import { resolvePaiDir } from "@hooks/lib/paths";

export function execute(): Result<string, PaiError> {
  return ok(resolvePaiDir());
}
