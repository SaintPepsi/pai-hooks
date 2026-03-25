/**
 * Manifest Validator — Bidirectional dep validation for hook manifests.
 *
 * Compares declared deps in a hook.json manifest against actual imports
 * parsed from the contract file. Detects:
 *   - MANIFEST_MISSING_DEP: contract imports something manifest doesn't declare
 *   - MANIFEST_GHOST_DEP: manifest declares something contract doesn't import
 *   - MANIFEST_SHARED_MISSING: shared file declared but not on disk
 *
 * Uses regex-based import parsing (not AST). Handles multi-line imports.
 * Skips `import type` statements (type-only imports don't create runtime deps).
 * Ignores sibling hook imports (@hooks/hooks/*).
 *
 * Follows DI pattern: ValidatorDeps interface + defaultDeps object.
 * Uses Result pattern from @hooks/core/result — no try-catch in business logic.
 */

import type { Result } from "@hooks/core/result";
import { ok, err } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { fileNotFound, invalidInput } from "@hooks/core/error";
import {
  readFile as adapterReadFile,
  fileExists as adapterFileExists,
} from "@hooks/core/adapters/fs";
import type { HookManifest } from "@hooks/cli/types/manifest";
import { dirname, resolve } from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DiagnosticCode =
  | "MANIFEST_MISSING_DEP"
  | "MANIFEST_GHOST_DEP"
  | "MANIFEST_SHARED_MISSING";

export interface ValidationDiagnostic {
  code: DiagnosticCode;
  message: string;
  dep: string;
}

export interface ValidationReport {
  hookName: string;
  valid: boolean;
  diagnostics: ValidationDiagnostic[];
}

export interface ValidatorDeps {
  readFile: (path: string) => Result<string, PaiError>;
  fileExists: (path: string) => boolean;
  stderr: (msg: string) => void;
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: ValidatorDeps = {
  readFile: adapterReadFile,
  fileExists: adapterFileExists,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── Import Parsing ─────────────────────────────────────────────────────────

/**
 * Category for a @hooks/* import path.
 * Returns null for paths that should be ignored (hooks/*, etc.).
 */
function categorizeImport(
  modulePath: string,
): { category: "core" | "lib" | "adapters"; dep: string } | null {
  // Ignore sibling hook imports
  if (modulePath.startsWith("@hooks/hooks/")) return null;

  // @hooks/core/adapters/* → adapters category
  const adapterMatch = modulePath.match(/^@hooks\/core\/adapters\/(.+)$/);
  if (adapterMatch) return { category: "adapters", dep: adapterMatch[1] };

  // @hooks/core/* → core category
  const coreMatch = modulePath.match(/^@hooks\/core\/(.+)$/);
  if (coreMatch) return { category: "core", dep: coreMatch[1] };

  // @hooks/lib/* → lib category
  const libMatch = modulePath.match(/^@hooks\/lib\/(.+)$/);
  if (libMatch) return { category: "lib", dep: libMatch[1] };

  // Everything else (e.g. @hooks/cli/*) — ignored
  return null;
}

/**
 * Parse result from contract source — two sets of categorized deps.
 *
 * - `runtime`: imports that include at least one value binding (affects MISSING check)
 * - `all`: every @hooks/* import including pure type imports (affects GHOST check)
 *
 * `import type { Foo }` → all only (not runtime)
 * `import { ok, type Result }` → both (ok is runtime)
 * `import { readFile }` → both
 *
 * This distinction matters because:
 *   MANIFEST_MISSING_DEP fires when a runtime import is not declared
 *   MANIFEST_GHOST_DEP fires when a declared dep is not imported at all
 *   A type-only import IS still imported — so it prevents ghost detection
 */
interface ParsedImports {
  runtime: Set<string>;
  all: Set<string>;
}

function parseImports(source: string): ParsedImports {
  const runtime = new Set<string>();
  const all = new Set<string>();

  // Normalize multi-line imports into single lines for regex matching.
  const normalized = source.replace(
    /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;/g,
    (_fullMatch, importClause: string, modulePath: string) => {
      const collapsed = importClause.replace(/\s+/g, " ").trim();
      return `import ${collapsed} from "${modulePath}";`;
    },
  );

  const importRegex = /^import\s+(.*?)\s+from\s+["'](@hooks\/[^"']+)["']\s*;/gm;

  let match: RegExpExecArray | null = importRegex.exec(normalized);
  while (match !== null) {
    const importClause = match[1];
    const modulePath = match[2];

    const categorized = categorizeImport(modulePath);
    if (categorized) {
      const depKey = `${categorized.category}/${categorized.dep}`;
      all.add(depKey);

      // Pure type imports: `import type { ... }` or `import type Foo`
      // These go into `all` but NOT `runtime`
      if (!importClause.startsWith("type ")) {
        runtime.add(depKey);
      }
    }

    match = importRegex.exec(normalized);
  }

  return { runtime, all };
}

/**
 * Collect declared deps from a manifest into a flat Set.
 * E.g. core: ["result"], lib: ["paths"], adapters: ["fs"]
 * → Set { "core/result", "lib/paths", "adapters/fs" }
 */
function collectDeclaredDeps(manifest: HookManifest): Set<string> {
  const deps = new Set<string>();

  for (const dep of manifest.deps.core) {
    deps.add(`core/${dep}`);
  }
  for (const dep of manifest.deps.lib) {
    deps.add(`lib/${dep}`);
  }
  for (const dep of manifest.deps.adapters) {
    deps.add(`adapters/${dep}`);
  }

  return deps;
}

// ─── Validator ──────────────────────────────────────────────────────────────

export function validate(
  contractPath: string,
  manifestPath: string,
  deps: ValidatorDeps = defaultDeps,
): Result<ValidationReport, PaiError> {
  // Read contract source
  const contractResult = deps.readFile(contractPath);
  if (!contractResult.ok) return contractResult;

  // Read manifest JSON
  const manifestResult = deps.readFile(manifestPath);
  if (!manifestResult.ok) return manifestResult;

  // Parse manifest
  const manifest = JSON.parse(manifestResult.value) as HookManifest;

  const diagnostics: ValidationDiagnostic[] = [];

  // Parse imports from contract — two sets
  const { runtime: runtimeDeps, all: allDeps } = parseImports(contractResult.value);

  // Collect declared deps from manifest
  const declaredDeps = collectDeclaredDeps(manifest);

  // Bidirectional comparison:

  // 1. Missing deps: runtime import not declared in manifest
  //    (type-only imports don't trigger missing — they're optional to declare)
  for (const dep of runtimeDeps) {
    if (!declaredDeps.has(dep)) {
      diagnostics.push({
        code: "MANIFEST_MISSING_DEP",
        message: `Contract imports ${dep} but manifest does not declare it`,
        dep,
      });
    }
  }

  // 2. Ghost deps: declared but not imported at all (not even type-only)
  for (const dep of declaredDeps) {
    if (!allDeps.has(dep)) {
      diagnostics.push({
        code: "MANIFEST_GHOST_DEP",
        message: `Manifest declares ${dep} but contract does not import it`,
        dep,
      });
    }
  }

  // 3. Shared file existence check
  //    Shared files live at the GROUP directory level (parent of hook directory)
  //    e.g. hooks/CronStatusLine/shared.ts, not hooks/CronStatusLine/CronFire/shared.ts
  if (Array.isArray(manifest.deps.shared)) {
    const hookDir = dirname(manifestPath);
    const groupDir = dirname(hookDir);
    for (const sharedFile of manifest.deps.shared) {
      const sharedPath = resolve(groupDir, sharedFile);
      if (!deps.fileExists(sharedPath)) {
        diagnostics.push({
          code: "MANIFEST_SHARED_MISSING",
          message: `Shared file ${sharedFile} not found at ${sharedPath}`,
          dep: sharedFile,
        });
      }
    }
  }

  return ok({
    hookName: manifest.name,
    valid: diagnostics.length === 0,
    diagnostics,
  });
}
