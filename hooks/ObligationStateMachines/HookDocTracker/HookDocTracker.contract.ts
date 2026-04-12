import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { projectHasHook } from "@hooks/hooks/ObligationStateMachines/DocObligationStateMachine.shared";
import {
  allDocFileNames,
  defaultDeps,
  docFileNameFromPath,
  getHookDirFromPath,
  isAnyDocFile,
  isHookSourceFile,
  parseTag,
  pendingPath,
  readHookDocSettings,
  tagPending as tag,
} from "@hooks/hooks/ObligationStateMachines/HookDocStateMachine.shared";
import type { ObligationDeps } from "@hooks/lib/obligation-machine";
import { addPending, clearMatching } from "@hooks/lib/obligation-machine";
import { getFilePath } from "@hooks/lib/tool-input";

export const HookDocTracker: SyncHookContract<ToolHookInput, ObligationDeps> = {
  name: "HookDocTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (projectHasHook("HookDocTracker")) return false;
    if (input.tool_name !== "Edit" && input.tool_name !== "Write") return false;
    const filePath = getFilePath(input);
    if (!filePath) return false;
    const settings = readHookDocSettings();
    return isHookSourceFile(filePath, settings.watchPatterns) || isAnyDocFile(filePath, settings);
  },

  execute(input: ToolHookInput, deps: ObligationDeps): Result<SyncHookJSONOutput, ResultError> {
    const filePath = getFilePath(input);
    if (!filePath) return ok({ continue: true });

    const settings = readHookDocSettings();
    const flagFile = pendingPath(deps.stateDir, input.session_id);

    // Doc file written → clear matching pending entries
    if (isAnyDocFile(filePath, settings)) {
      const docDir = getHookDirFromPath(filePath);
      const writtenDoc = docFileNameFromPath(filePath);

      if (settings.mode === "linked") {
        // Linked mode: clear ALL entries for the directory only when ALL doc files exist
        const allDocsExist = allDocFileNames(settings).every((name) =>
          deps.fileExists(`${docDir}/${name}`),
        );
        if (!allDocsExist) return ok({ continue: true });

        const { remaining, cleared } = clearMatching(deps, flagFile, (p) => {
          const { source } = parseTag(p);
          return getHookDirFromPath(source) === docDir;
        });

        if (cleared) {
          deps.stderr(
            remaining === 0
              ? "[HookDocTracker] All pending hooks documented — clearing flag"
              : `[HookDocTracker] Cleared documented hook, ${remaining} still pending`,
          );
        }
      } else {
        // Independent mode (default): clear only entries tagged with the written doc name
        const { remaining, cleared } = clearMatching(deps, flagFile, (p) => {
          const { source, docFile } = parseTag(p);
          return getHookDirFromPath(source) === docDir && docFile === writtenDoc;
        });

        if (cleared) {
          deps.stderr(
            remaining === 0
              ? "[HookDocTracker] All pending hooks documented — clearing flag"
              : `[HookDocTracker] Cleared documented hook, ${remaining} still pending`,
          );
        }
      }
      return ok({ continue: true });
    }

    // Hook source file modified → add tagged entries for each doc file
    for (const docName of allDocFileNames(settings)) {
      addPending(deps, flagFile, tag(filePath, docName));
    }
    deps.stderr(`[HookDocTracker] Hook source modified: ${filePath} — docs pending`);
    return ok({ continue: true });
  },

  defaultDeps,
};
