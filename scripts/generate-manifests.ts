/**
 * Manifest Generator — Static analysis of hook contracts to produce manifest files.
 *
 * Discovers hooks by walking `hooks/` for `*.contract.ts` files.
 * Extracts event type and dependencies via regex (no execution, no AST).
 * Produces:
 *   - hook.json per hook (merge mode: preserve human-curated fields)
 *   - group.json per group directory
 *   - presets.json at repo root (only if absent)
 *
 * Flags:
 *   --dry-run  Print what would be written, touch nothing
 *
 * Uses DI pattern + Result pipelines. No try-catch in business logic.
 */

import type { Result } from "@hooks/core/result";
import { ok, err } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { invalidInput, fileNotFound } from "@hooks/core/error";
import {
  readFile as adapterReadFile,
  writeFile as adapterWriteFile,
  readJson as adapterReadJson,
  readDir as adapterReadDir,
  fileExists as adapterFileExists,
} from "@hooks/core/adapters/fs";
import type { HookManifest, GroupManifest, PresetConfig } from "@hooks/cli/types/manifest";
import { MANIFEST_SCHEMA_VERSION } from "@hooks/cli/types/manifest";
import type { HookEventType } from "@hooks/core/types/hook-inputs";
import { join, basename, dirname } from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GeneratorDeps {
  readFile: (path: string) => Result<string, PaiError>;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  readJson: <T = unknown>(path: string) => Result<T, PaiError>;
  readDir: (path: string) => Result<string[], PaiError>;
  fileExists: (path: string) => boolean;
  stderr: (msg: string) => void;
}

export interface GeneratorOptions {
  hooksDir: string;
  repoRoot: string;
  dryRun: boolean;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GeneratorOutput {
  files: GeneratedFile[];
  hookCount: number;
  groupCount: number;
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: GeneratorDeps = {
  readFile: adapterReadFile,
  writeFile: adapterWriteFile,
  readJson: adapterReadJson,
  readDir: adapterReadDir,
  fileExists: adapterFileExists,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── Event Extractor ────────────────────────────────────────────────────────

const VALID_EVENTS = new Set<HookEventType>([
  "PreToolUse", "PostToolUse", "SessionStart", "SessionEnd",
  "UserPromptSubmit", "PreCompact", "Stop", "SubagentStart", "SubagentStop",
]);

/**
 * Extract event type from contract source via regex.
 */
export function extractEvent(source: string): Result<HookEventType, PaiError> {
  const match = source.match(/event:\s*["'](\w+)["']/);
  if (!match) {
    return err(invalidInput("No event field found in contract source"));
  }
  const event = match[1] as HookEventType;
  if (!VALID_EVENTS.has(event)) {
    return err(invalidInput(`Invalid event type: ${event}`));
  }
  return ok(event);
}

// ─── Discovery ──────────────────────────────────────────────────────────────

interface DiscoveredHook {
  name: string;
  group: string;
  contractPath: string;
  hookDir: string;
  groupDir: string;
}

/**
 * Walk hooks/*\/* finding directories with *.contract.ts files.
 */
export function discoverHooks(
  hooksDir: string,
  deps: GeneratorDeps,
): Result<DiscoveredHook[], PaiError> {
  const groupsResult = deps.readDir(hooksDir);
  if (!groupsResult.ok) return groupsResult;

  const hooks: DiscoveredHook[] = [];

  for (const groupName of groupsResult.value) {
    const groupDir = join(hooksDir, groupName);

    // readDir failing means it's a file, not a directory — skip
    const hookDirsResult = deps.readDir(groupDir);
    if (!hookDirsResult.ok) continue;

    for (const hookName of hookDirsResult.value) {
      const hookDir = join(groupDir, hookName);
      const contractPath = join(hookDir, `${hookName}.contract.ts`);

      if (deps.fileExists(contractPath)) {
        hooks.push({
          name: hookName,
          group: groupName,
          contractPath,
          hookDir,
          groupDir,
        });
      }
    }
  }

  return ok(hooks);
}

// ─── Shared File Discovery ──────────────────────────────────────────────────

/**
 * Find *.shared.ts or shared.ts files in a group directory.
 * Returns filenames (not full paths).
 */
function discoverSharedFilesViaManifest(
  groupDir: string,
  deps: GeneratorDeps,
): string[] {
  const result = deps.readDir(groupDir);
  if (!result.ok) return [];

  return result.value
    .filter((f) => f === "shared.ts" || f.endsWith(".shared.ts"))
    .sort();
}

// ─── Duplicate Check ────────────────────────────────────────────────────────

function checkDuplicateNames(
  hooks: DiscoveredHook[],
): Result<void, PaiError> {
  const seen = new Map<string, string>();
  for (const hook of hooks) {
    const existing = seen.get(hook.name);
    if (existing) {
      return err(
        invalidInput(
          `Duplicate hook name "${hook.name}" found in groups "${existing}" and "${hook.group}"`,
        ),
      );
    }
    seen.set(hook.name, hook.group);
  }
  return ok(undefined);
}

// ─── Manifest Builders ──────────────────────────────────────────────────────

function buildHookManifest(
  hook: DiscoveredHook,
  source: string,
  existing: Partial<HookManifest> | null,
): Result<HookManifest, PaiError> {
  const eventResult = extractEvent(source);
  if (!eventResult.ok) {
    return err(
      invalidInput(`${hook.contractPath}: ${eventResult.error.message}`),
    );
  }

  const manifest: HookManifest = {
    name: hook.name,
    group: hook.group,
    event: eventResult.value,
    // Preserve human-curated fields if they exist
    description: existing?.description ?? "",
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    tags: existing?.tags ?? [],
    presets: existing?.presets ?? [],
  };

  return ok(manifest);
}

function buildGroupManifest(
  groupName: string,
  hookNames: string[],
  sharedFiles: string[],
  existing: Partial<GroupManifest> | null,
): GroupManifest {
  return {
    name: groupName,
    description: existing?.description ?? "",
    hooks: [...hookNames].sort(),
    sharedFiles,
  };
}

// ─── Generator Core ─────────────────────────────────────────────────────────

export function generate(
  options: GeneratorOptions,
  deps: GeneratorDeps = defaultDeps,
): Result<GeneratorOutput, PaiError> {
  const { hooksDir, repoRoot, dryRun } = options;

  // 1. Discover hooks
  const hooksResult = discoverHooks(hooksDir, deps);
  if (!hooksResult.ok) return hooksResult;
  const hooks = hooksResult.value;

  // 2. Check for duplicate names
  const dupResult = checkDuplicateNames(hooks);
  if (!dupResult.ok) return dupResult;

  // 3. Group hooks by group name
  const groups = new Map<string, DiscoveredHook[]>();
  for (const hook of hooks) {
    const group = groups.get(hook.group) ?? [];
    group.push(hook);
    groups.set(hook.group, group);
  }

  const files: GeneratedFile[] = [];

  // 4. Generate hook manifests
  for (const hook of hooks) {
    const sourceResult = deps.readFile(hook.contractPath);
    if (!sourceResult.ok) {
      return err(
        invalidInput(`Failed to read contract: ${hook.contractPath}`),
      );
    }

    // Read existing hook.json for merge mode
    const existingPath = join(hook.hookDir, "hook.json");
    let existing: Partial<HookManifest> | null = null;
    if (deps.fileExists(existingPath)) {
      const existingResult = deps.readJson<HookManifest>(existingPath);
      if (existingResult.ok) {
        existing = existingResult.value;
      }
    }

    const manifestResult = buildHookManifest(
      hook,
      sourceResult.value,
      existing,
    );
    if (!manifestResult.ok) return manifestResult;

    const content = JSON.stringify(manifestResult.value, null, 2);
    files.push({ path: existingPath, content });
  }

  // 5. Generate group manifests
  for (const [groupName, groupHooks] of groups) {
    const groupDir = groupHooks[0].groupDir;
    const hookNames = groupHooks.map((h) => h.name);
    const sharedFiles = discoverSharedFilesViaManifest(groupDir, deps);

    // Read existing group.json for merge mode
    const groupJsonPath = join(groupDir, "group.json");
    let existing: Partial<GroupManifest> | null = null;
    if (deps.fileExists(groupJsonPath)) {
      const existingResult = deps.readJson<GroupManifest>(groupJsonPath);
      if (existingResult.ok) {
        existing = existingResult.value;
      }
    }

    const groupManifest = buildGroupManifest(
      groupName,
      hookNames,
      sharedFiles,
      existing,
    );

    const content = JSON.stringify(groupManifest, null, 2);
    files.push({ path: groupJsonPath, content });
  }

  // 6. Generate presets.json (only if absent)
  const presetsPath = join(repoRoot, "presets.json");
  if (!deps.fileExists(presetsPath)) {
    const defaultPresets: PresetConfig = {
      minimal: {
        description: "Essential safety hooks only",
        hooks: [],
      },
      full: {
        description: "All hooks",
        groups: ["*"],
      },
    };
    const content = JSON.stringify(defaultPresets, null, 2);
    files.push({ path: presetsPath, content });
  }

  // 7. Write files (unless dry-run)
  if (!dryRun) {
    for (const file of files) {
      const writeResult = deps.writeFile(file.path, file.content);
      if (!writeResult.ok) return writeResult;
    }
  }

  // 8. Report
  for (const file of files) {
    const action = dryRun ? "[DRY-RUN]" : "[WRITE]";
    deps.stderr(`${action} ${file.path}`);
  }

  return ok({
    files,
    hookCount: hooks.length,
    groupCount: groups.size,
  });
}

// ─── CLI Entry ──────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  // Resolve repo root from this script's location
  const scriptDir = dirname(new URL(import.meta.url).pathname);
  const repoRoot = join(scriptDir, "..");
  const hooksDir = join(repoRoot, "hooks");

  const result = generate({ hooksDir, repoRoot, dryRun }, defaultDeps);

  if (!result.ok) {
    process.stderr.write(`[ERROR] ${result.error.message}\n`);
    process.exit(1);
  }

  const { hookCount, groupCount, files } = result.value;
  const action = dryRun ? "Would generate" : "Generated";
  process.stderr.write(
    `\n${action} ${files.length} manifest files (${hookCount} hooks, ${groupCount} groups)\n`,
  );

  if (dryRun) {
    process.exit(0);
  }
}

// Run if executed directly
const isMain = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("generate-manifests.ts");
if (isMain) {
  main();
}
