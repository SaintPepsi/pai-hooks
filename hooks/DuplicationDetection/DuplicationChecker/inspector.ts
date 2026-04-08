/**
 * Inspector for the DuplicationChecker hook.
 *
 * Reads the duplication index from the artifacts directory and returns
 * summary, raw, and JSON views for the `paih inspect` CLI command.
 */

import { PaihError, PaihErrorCode } from "@hooks/cli/core/error";
import { type Result, err, ok } from "@hooks/cli/core/result";
import { tryCatch } from "@hooks/core/result";
import type { DuplicationIndex } from "@hooks/hooks/DuplicationDetection/shared";
import { getArtifactsDir } from "@hooks/hooks/DuplicationDetection/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InspectResult {
  statePath: string;
  summary: string;
  raw: string;
  json: Record<string, unknown>;
}

export interface InspectorDeps {
  readFile: (path: string) => string | null;
  exists: (path: string) => boolean;
  cwd: () => string;
  getBranch: (dir: string) => string | null;
}

// ─── Inspector ──────────────────────────────────────────────────────────────

export function inspect(projectDir: string, deps: InspectorDeps): Result<InspectResult, PaihError> {
  const branch = deps.getBranch(projectDir) ?? "default";
  const artifactsDir = getArtifactsDir(projectDir, branch);
  const statePath = `${artifactsDir}/index.json`;

  if (!deps.exists(statePath)) {
    return err(
      new PaihError(
        PaihErrorCode.TargetNotFound,
        `No state found for DuplicationChecker at ${statePath}`,
        { statePath },
      ),
    );
  }

  const content = deps.readFile(statePath);
  if (content === null) {
    return err(
      new PaihError(
        PaihErrorCode.TargetNotFound,
        `No state found for DuplicationChecker at ${statePath}`,
        { statePath },
      ),
    );
  }

  const parseResult = tryCatch(
    () => JSON.parse(content) as DuplicationIndex,
    () =>
      new PaihError(
        PaihErrorCode.ManifestParseError,
        `Failed to parse DuplicationChecker index at ${statePath}`,
        { statePath },
      ),
  );

  if (!parseResult.ok) {
    return err(parseResult.error);
  }

  const index = parseResult.value;

  const patterns = index.patterns ?? [];
  const tier1Count = patterns.filter((p) => p.tier === 1).length;
  const tier2Count = patterns.filter((p) => p.tier === 2).length;
  const patternCount = patterns.length;

  const hashGroupCount = index.hashGroups.length;
  const nameGroupCount = index.nameGroups.length;
  const sigGroupCount = index.sigGroups.length;

  const builtAtFormatted = formatBuiltAt(index.builtAt);
  const branchDisplay = index.branch ?? branch;

  const summary = [
    `DuplicationChecker — state for ${projectDir}`,
    "",
    `  State file:    ${statePath}`,
    `  Built at:      ${builtAtFormatted}`,
    `  Branch:        ${branchDisplay}`,
    `  Files:         ${index.fileCount}`,
    `  Functions:     ${index.functionCount}`,
    `  Patterns:      ${patternCount}${patternCount > 0 ? ` (${tier1Count} tier-1, ${tier2Count} tier-2)` : ""}`,
    "",
    `  Hash groups:   ${hashGroupCount}`,
    `  Name groups:   ${nameGroupCount}`,
    `  Sig groups:    ${sigGroupCount}`,
  ].join("\n");

  const json: Record<string, unknown> = {
    statePath,
    version: index.version,
    root: index.root,
    branch: branchDisplay,
    builtAt: index.builtAt,
    fileCount: index.fileCount,
    functionCount: index.functionCount,
    hashGroupCount,
    nameGroupCount,
    sigGroupCount,
    patternCount,
    tier1Count,
    tier2Count,
  };

  return ok({ statePath, summary, raw: content, json });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Format ISO timestamp to readable date string. */
function formatBuiltAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
