#!/usr/bin/env bun
/**
 * GenerateDashboard.ts — Wrapper that runs the .mjs implementation via Bun.spawn
 */

import { dirname, join } from "node:path";

const scriptDir = dirname(Bun.main);
const mjsPath = join(scriptDir, "GenerateDashboard.mjs");
const proc = Bun.spawnSync(["node", mjsPath], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(proc.exitCode ?? 0);
