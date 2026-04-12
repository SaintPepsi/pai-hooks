/**
 * inspect command — Show hook state for a project directory.
 *
 * Usage: paih inspect <hookName> [--project <dir>] [--raw] [--json]
 */

import type { ParsedArgs } from "@hooks/cli/core/args";
import { invalidArgs, PaihError, PaihErrorCode } from "@hooks/cli/core/error";
import type { Result } from "@hooks/cli/core/result";
import { err } from "@hooks/cli/core/result";
import {
  type InspectorDeps,
  inspect as inspectDuplicationChecker,
} from "@hooks/hooks/DuplicationDetection/DuplicationChecker/inspector";

const INSPECTABLE_HOOKS = new Set(["DuplicationChecker"]);

export interface InspectDeps extends InspectorDeps {}

export function inspect(args: ParsedArgs, deps: InspectDeps): Result<string, PaihError> {
  const hookName = args.names[0];
  if (!hookName) {
    return err(invalidArgs("Usage: paih inspect <hookName> [--project <dir>] [--raw] [--json]"));
  }

  if (!INSPECTABLE_HOOKS.has(hookName)) {
    return err(
      new PaihError(
        PaihErrorCode.HookNotFound,
        `Unknown hook: ${hookName}. Inspectable hooks: ${[...INSPECTABLE_HOOKS].join(", ")}`,
        { hookName },
      ),
    );
  }

  const projectDir = (args.flags.project as string) || deps.cwd();

  const result = inspectDuplicationChecker(projectDir, deps);
  if (!result.ok) return result;

  if (args.flags.raw) return { ok: true, value: result.value.raw };
  if (args.flags.json) return { ok: true, value: JSON.stringify(result.value.json, null, 2) };
  return { ok: true, value: result.value.summary };
}
