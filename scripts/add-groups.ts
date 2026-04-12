#!/usr/bin/env bun

/**
 * One-time script: adds group fields to patterns.json entries.
 * Preserves the YAML comment groupings from the original file.
 */

import { join } from "node:path";
import { readFile, writeFile } from "@hooks/core/adapters/fs";

const path = join(import.meta.dir, "..", "hooks", "SecurityValidator", "patterns.json");

const fileResult = readFile(path);
if (!fileResult.ok) {
  process.stderr.write(`Failed to read: ${fileResult.error.message}\n`);
  process.exit(1);
}

const config = JSON.parse(fileResult.value);

// ─── Blocked groups (from YAML comments) ─────────────────────────────────
// Original: "# Filesystem root - absolute block"
// Original: "# Home directory - only block entire home, not subdirs"
// etc.
const blockedGroups: Record<string, string> = {
  "Filesystem destruction": "Filesystem root - absolute block",
  "Home directory destruction (entire home)":
    "Home directory - only block entire home, not subdirs",
  "PAI infrastructure destruction (entire .claude)":
    "PAI infrastructure - only block entire .claude, not subdirs",
  "Projects directory destruction (entire Projects)":
    "Projects directory - only block entire Projects, not subdirs",
  "Filesystem destruction with sudo": "Sudo variants",
  "Home directory destruction with sudo": "Sudo variants",
  "Disk destruction": "Disk operations",
  "Disk partitioning": "Disk operations",
  "APFS container deletion": "Disk operations",
  "Volume destruction": "Disk operations",
  "Disk overwrite": "Disk operations",
  "Filesystem format": "Disk operations",
  "Repository deletion": "GitHub operations",
  "Repository exposure": "GitHub operations",
};

for (const entry of config.bash.blocked) {
  const group = blockedGroups[entry.reason];
  if (group) entry.group = group;
  if (entry.reason.startsWith("Auto-hardened"))
    entry.group = "Auto-hardened by settings bypass detection";
}

// ─── Confirm groups (from YAML comments) ─────────────────────────────────
const confirmGroups: Record<string, string> = {
  "Force push can lose commits": "Git operations",
  "Loses uncommitted changes": "Git operations",
  "Bulk S3 deletion": "Cloud - AWS",
  "EC2 instance termination": "Cloud - AWS",
  "RDS deletion": "Cloud - AWS",
  "GCP resource deletion": "Cloud - GCP",
  "Infrastructure destruction": "Infrastructure as Code",
  "Auto-approve bypasses review": "Infrastructure as Code",
  "Container/image cleanup": "Containers",
  "Volume data deletion": "Containers",
  "Namespace deletion": "Containers",
  "Database deletion (confirm scope)": "Databases",
  "Database destruction": "Databases",
  "Table destruction": "Databases",
  "Table data destruction": "Databases",
};

for (const entry of config.bash.confirm) {
  const group = confirmGroups[entry.reason];
  if (group) entry.group = group;
}

// ─── Alert groups (from YAML comment: "# ALERT - Suspicious but allowed")
for (const entry of config.bash.alert) {
  entry.group = "Piping remote content to shell";
}

const writeResult = writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
if (!writeResult.ok) {
  process.stderr.write(`Failed to write: ${writeResult.error.message}\n`);
  process.exit(1);
}

process.stdout.write("Groups added to patterns.json\n");

// Count groups
const allEntries = [...config.bash.blocked, ...config.bash.confirm, ...config.bash.alert];
const grouped = allEntries.filter((e: { group?: string }) => e.group);
process.stdout.write(`${grouped.length}/${allEntries.length} entries have groups\n`);
