/**
 * TSConfig Generator — Write tsconfig.json for installed hooks.
 *
 * Generates .claude/hooks/tsconfig.json with @hooks/* path aliases
 * so installed hooks can resolve their core dependencies.
 *
 * Path alias pattern matches the source repo's tsconfig.json
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-a0619c6a/tsconfig.json).
 */

import type { Result } from "@hooks/cli/core/result";
import { ok } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import type { CliDeps } from "@hooks/cli/types/deps";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TsConfigJson {
  compilerOptions: {
    target: string;
    module: string;
    moduleResolution: string;
    strict: boolean;
    esModuleInterop: boolean;
    skipLibCheck: boolean;
    types: string[];
    baseUrl: string;
    paths: Record<string, string[]>;
  };
  include: string[];
  exclude: string[];
}

// ─── Generator ──────────────────────────────────────────────────────────────

/**
 * Generate tsconfig.json at .claude/hooks/ with path aliases pointing
 * to _core/ for shared dependencies.
 */
export function generateTsconfig(
  claudeDir: string,
  deps: CliDeps,
): Result<void, PaihError> {
  const hooksDir = `${claudeDir}/hooks`;
  const tsconfigPath = `${hooksDir}/tsconfig.json`;

  const config: TsConfigJson = {
    compilerOptions: {
      target: "ES2022",
      module: "esnext",
      moduleResolution: "bundler",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      types: ["bun-types"],
      baseUrl: ".",
      paths: {
        "@hooks/*": ["./_core/*"],
      },
    },
    include: ["**/*.ts"],
    exclude: ["node_modules", ".paih-staging"],
  };

  const content = JSON.stringify(config, null, 2) + "\n";

  const ensureResult = deps.ensureDir(hooksDir);
  if (!ensureResult.ok) return ensureResult;

  return deps.writeFile(tsconfigPath, content);
}
