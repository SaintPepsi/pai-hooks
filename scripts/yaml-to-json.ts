#!/usr/bin/env bun

/**
 * One-time migration script: converts patterns.yaml to patterns.json.
 * Handles the YAML escaping bug in the auto-hardened pattern.
 */

import { join } from "node:path";
import { readFile, writeFile } from "@hooks/core/adapters/fs";

const yamlPath = join(import.meta.dir, "..", "hooks", "SecurityValidator", "patterns.yaml");
const jsonPath = join(import.meta.dir, "..", "hooks", "SecurityValidator", "patterns.json");

const rawResult = readFile(yamlPath);
if (!rawResult.ok) {
  process.stderr.write(`Failed to read ${yamlPath}: ${rawResult.error.message}\n`);
  process.exit(1);
}

// Fix YAML double-quote escape issue on auto-hardened line (\s \( \. unescaped)
const raw = rawResult.value.replace(
  /- pattern: "python3\?\\s\+-c\\s\+\.\*open\\s\*\\\(.\*settings\\\.json"/,
  "- pattern: 'python3?\\s+-c\\s+.*open\\s*\\(.*settings\\.json'",
);

const { parse } = await import("yaml");
const parsed = parse(raw);

if (!parsed.projects) parsed.projects = {};

const writeResult = writeFile(jsonPath, `${JSON.stringify(parsed, null, 2)}\n`);
if (!writeResult.ok) {
  process.stderr.write(`Failed to write ${jsonPath}: ${writeResult.error.message}\n`);
  process.exit(1);
}

process.stdout.write(`Written: ${jsonPath}\n`);
process.stdout.write(`Blocked entries: ${parsed.bash.blocked.length}\n`);
process.stdout.write(`Confirm entries: ${parsed.bash.confirm.length}\n`);
process.stdout.write(`Alert entries: ${parsed.bash.alert.length}\n`);
