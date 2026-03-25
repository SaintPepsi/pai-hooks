import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";

export function execute(): Result<string, PaiError> {
  return ok("no identity import");
}
