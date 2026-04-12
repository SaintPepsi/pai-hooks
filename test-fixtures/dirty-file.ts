import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import path from "path";

const CONFIG_PATH = process.env.PAI_CONFIG_PATH || "/etc/pai/config.json";
const LOG_DIR = process.env.PAI_LOG_DIR || "/var/log/pai";

function loadConfig(): Record<string, unknown> {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error("Failed to load config:", err);
    return {};
  }
}

function processData(data: string): string {
  try {
    const result = execSync(`echo "${data}" | jq .`, { encoding: "utf-8" });
    return result.trim();
  } catch (err) {
    console.error("Processing failed:", err);
    throw err;
  }
}

function writeOutput(output: string, filename: string): void {
  try {
    const outPath = path.join(LOG_DIR, filename);
    writeFileSync(outPath, output, "utf-8");
  } catch (err) {
    console.error("Write failed:", err);
    throw new Error(`Could not write to ${filename}`);
  }
}

function getGitBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
    }).trim();
  } catch {
    return "unknown";
  }
}

// --- New violation categories ---

// Inline import type violation
function processOptions(opts: import("./config").ConfigOptions): void {
  console.log(opts);
}

// as any violation
const parsed = JSON.parse("{}") as any;

// Relative import violation (already present above via "child_process" etc, but this is explicit)
import { helper } from "../utils/helper";

export async function run(input: Record<string, unknown>): Promise<void> {
  const config = loadConfig();
  const branch = getGitBranch();

  const raw = JSON.stringify(input);
  const processed = processData(raw);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `output-${branch}-${timestamp}.json`;

  writeOutput(processed, filename);
  processOptions(parsed);
  helper(config);

  console.log("Done. Config keys:", Object.keys(config).join(", "));
}
