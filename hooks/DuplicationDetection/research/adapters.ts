// Adapter layer for pattern-detector spike.
// Wraps throwing APIs (fs, crypto, SWC parseSync) behind null-returning interfaces.
// try-catch is confined to this adapter boundary per coding standards.

import { parseSync } from "@swc/core";
import type { Module } from "@swc/core";

// ─── Filesystem Adapters ────────────────────────────────────────────────────

export function readFileSafe(path: string): string | null {
  const fs = require("fs");
  if (!fs.existsSync(path)) return null;
  return fs.readFileSync(path, "utf-8") as string;
}

export function readDirSafe(path: string): string[] | null {
  const fs = require("fs");
  if (!fs.existsSync(path)) return null;
  return fs.readdirSync(path) as string[];
}

export function isDirectorySafe(path: string): boolean {
  const fs = require("fs");
  if (!fs.existsSync(path)) return false;
  return fs.statSync(path).isDirectory() as boolean;
}

export function existsSafe(path: string): boolean {
  return require("fs").existsSync(path) as boolean;
}

// ─── Crypto Adapter ─────────────────────────────────────────────────────────

export function sha256Short(content: string): string {
  return require("crypto").createHash("sha256").update(content).digest("hex").slice(0, 16) as string;
}

// ─── SWC Parse Adapter ──────────────────────────────────────────────────────
// parseSync throws on unparseable syntax — no non-throwing API exists.
// This adapter returns null for files SWC cannot parse.

export function parseTsSourceSafe(source: string, isTsx: boolean): Module | null {
  try {
    return parseSync(source, {
      syntax: "typescript",
      tsx: isTsx,
      target: "es2022",
    });
  } catch {
    return null;
  }
}

// ─── Path Adapters ──────────────────────────────────────────────────────────

export function joinPath(...parts: string[]): string {
  return require("path").join(...parts) as string;
}

export function resolvePath(path: string): string {
  return require("path").resolve(path) as string;
}

// ─── Environment Adapter ───────────────────────────────────────────────────

export function getHomeDir(): string {
  return (process.env.HOME ?? "") as string;
}
