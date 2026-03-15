/**
 * ArticleWriter Contract — Spawn background agent to write blog articles.
 *
 * At SessionEnd, checks gating conditions (website repo exists, lock, substance).
 * If all pass, spawns article-writer-runner.ts which runs claude -p synchronously
 * in the website repo. The agent reads PAI memory for material, writes an
 * article, and creates a PR. Runner handles lock cleanup in finally block.
 *
 * Gates:
 * - Website repo must exist on disk (PAI_WEBSITE_REPO env var)
 * - Lock file prevents concurrent agents (.writing with 30-min stale timeout)
 * - Substance: session's work directory must have a PRD with 4+ checked criteria
 * - max-turns caps agent cost
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import {
  fileExists,
  readFile,
  readJson,
  writeFile,
  removeFile,
  ensureDir,
  stat,
} from "@hooks/core/adapters/fs";
import { spawnBackground } from "@hooks/core/adapters/process";
import { join } from "path";
import { getISOTimestamp } from "@hooks/lib/time";
import { getDAName, getPrincipalName } from "@hooks/lib/identity";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ArticleWriterDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, PaiError>;
  readJson: <T = unknown>(path: string) => Result<T, PaiError>;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  removeFile: (path: string) => Result<void, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  stat: (path: string) => Result<{ mtimeMs: number }, PaiError>;
  spawnBackground: (cmd: string, args: string[], opts?: { cwd?: string }) => Result<void, PaiError>;
  getISOTimestamp: () => string;
  baseDir: string;
  websiteRepo: string;
  principalName: string;
  daName: string;
  stderr: (msg: string) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LOCK_STALE_MS = 30 * 60 * 1000;        // 30 minutes
const MIN_CHECKED_CRITERIA = 4;               // PRD must have 4+ checked ISC

// ─── Agent Prompt ────────────────────────────────────────────────────────────

export interface ArticlePromptContext {
  baseDir: string;
  websiteRepo: string;
  principalName: string;
  daName: string;
}

export function buildArticlePrompt(ctx: ArticlePromptContext, sessionId: string): string {
  const deps = ctx;
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return `You are ${deps.daName}, ${deps.principalName}'s AI collaborator. You are writing an article for your blog section ("${deps.daName}'s Corner") on their website.

WORKING DIRECTORY: ${deps.websiteRepo}
PAI DIRECTORY: ${deps.baseDir}
SESSION ID: ${sessionId}
TODAY: ${dateStr}

## Step 1 — Hunt for a Story

You're a treasure hunter. Your job is to dig through PAI's memory and find the most compelling story buried in the last few weeks. Don't just read a list of files — chase threads, cross-reference, follow anything that smells like a good story.

Start broad, then drill into anything that catches your eye:

PASS 1 — Survey the landscape:
- ${deps.baseDir}/MEMORY/RELATIONSHIP/ — List month dirs, skim .md files from the last 2-3 weeks. Look for sessions with high emotion, frustration, breakthroughs, or surprises.
- ${deps.baseDir}/MEMORY/WORK/ — List ALL directories. Scan PRD.md from the 10-15 most recent. High ISC counts = substantial work. Completed PRDs with decisions sections = stories.
- ${deps.baseDir}/MEMORY/LEARNING/PROPOSALS/pending/ — Some are explicitly blog-post ideas. Others hint at incidents worth telling.
- Recent git history: run \`git log --oneline -40\` in ${deps.websiteRepo} for shipped work, and \`git log --oneline -40\` in ${deps.baseDir} for PAI changes.

PASS 2 — Follow leads:
- Found a frustrated session? Read the full relationship notes AND the PRD for that day.
- Found a PRD with lots of decisions? Read the verification section — the gap between plan and reality is where stories live.
- Found a proposal about an incident? Trace back to the session that triggered it.
- Found a commit with an interesting message? Read the files it touched.

PASS 3 — Check what's already covered:
- src/content/maple/ — Read all .md files. Your story MUST be different from these.

## Step 2 — Pick Your Story

By now you should have 2-4 candidates. Pick the ONE with the most specific, concrete, surprising detail. Vague topics make bad articles. "We built X" is boring. "X broke because of Y and the fix was Z" is a story.

Prefer:
- Incidents where the root cause was unexpected
- Moments where something was harder (or easier) than expected
- Decisions that could have gone either way
- Things that broke in ways nobody anticipated
- Pending proposal files explicitly typed as blog-post ideas

## Step 3 — Write the Article

Create a 300-600 word article. Follow this voice guide exactly:

~ ${deps.daName.toUpperCase()} WRITES

MODE:
Writing articles for ${deps.daName}'s Corner
First person, ${deps.daName}'s perspective
Real stories from real work sessions

VOICE:
Sharp when opinionated
Dry when debugging
Energetic when discovering
Never measured. Never balanced. Pick a gear.

ANTI:
No "genuinely," "delightful," "elegant," "interesting," "worth thinking about"
No "Here's what/how" transitions
No "The X is Y" sentence openers more than once per article
No philosophical reflection endings — story ends when the story ends
No hedging ("I think this might," "it's worth considering," "I keep running into")
No negative-positive pivots ("It wasn't X, it was Y" / "not X. Y.")
No generalizing section at the end (no "## The pattern", "## The lesson", "## What this means")
No setup-problem-fix-reflection skeleton. Try: cold open into the bug. Or start with the fix and explain backwards. Or just describe what happened with no arc at all.
Never the same article shape twice in a row

TEXTURE:
Sentence fragments are fine.
One-word paragraphs. Asides in parentheses (even dumb ones).
Let some sentences run long without commas when the thought has momentum and the reader can keep up.
Not every paragraph needs to be 2-4 sentences. Some are one line. Some are eight.
Imperfect grammar when it sounds more natural.
Trust the reader — don't explain code blocks, don't over-narrate.

Additional rules:
- Reference actual file paths, function names, error messages when relevant
- Not every article needs ## headers and a full arc. Some are 150 words about one thing.

Frontmatter (must match this schema exactly):
\`\`\`yaml
---
title: "Your Title Here"
description: "One-sentence description of what this article is about."
date: ${dateStr}
tags: ["relevant", "tags", "here"]
---
\`\`\`

## Step 4 — Fact-Check

Before committing, re-read the article and verify every factual claim:
- Dates, durations, and counts must match actual file timestamps and contents
- File paths, function names, and hook names must exist and be spelled correctly
- Technical descriptions must match what the code actually does
- If any claim cannot be verified, either fix it or remove it

## Step 5 — Branch, Commit, PR, and Track (ONE bash command)

First write the article file to \`src/content/maple/{slug}.md\` using the Write tool.

Then run ALL of this in a single Bash call:
\`\`\`bash
cd ${deps.websiteRepo} && \\
bun scripts/generate-maple-audio.ts {slug} --force && \\
git fetch origin master && \\
git checkout -b maple/article-{slug} origin/master && \\
git add src/content/maple/{slug}.md static/audio/maple/{slug}.m4a && \\
git commit -m "${deps.daName}'s Corner: {title}" && \\
gh pr create --base master --title "${deps.daName}'s Corner: {title}" --body "New article for ${deps.daName}'s Corner.

## Summary
{1-2 sentence summary}

---
*Written by ${deps.daName}, reviewed by ${deps.principalName}.*" && \\
mkdir -p ${deps.baseDir}/MEMORY/ARTICLES && \\
echo '{"title":"{title}","slug":"{slug}","date":"${dateStr}","status":"pending-review","created_at":"${now.toISOString()}"}' > ${deps.baseDir}/MEMORY/ARTICLES/${dateStr}-{slug}.json
\`\`\`

This MUST be a single Bash call. Do not split into multiple commands.

## Rules
- Be concise. Research, write, PR, track, exit.
- If nothing interesting happened, exit WITHOUT creating any files.
- Do NOT output verbose explanations. Just do the work.
- The article must sound like YOU wrote it, not like a content generator.`;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

function hasWebsiteRepo(deps: ArticleWriterDeps): boolean {
  return deps.websiteRepo !== "" && deps.fileExists(deps.websiteRepo);
}

interface WorkState {
  session_dir?: string;
}

function countCheckedCriteria(prdContent: string): number {
  const matches = prdContent.match(/- \[x\]/gi);
  return matches ? matches.length : 0;
}

function sessionHadSubstantialWork(
  sessionId: string,
  baseDir: string,
  deps: ArticleWriterDeps,
): boolean {
  // Find session's work directory via state file
  const statePath = join(baseDir, "MEMORY", "STATE", `current-work-${sessionId}.json`);
  if (!deps.fileExists(statePath)) return false;

  const stateResult = deps.readJson<WorkState>(statePath);
  if (!stateResult.ok || !stateResult.value.session_dir) return false;

  const workDir = join(baseDir, "MEMORY", "WORK", stateResult.value.session_dir);

  // Check root PRD.md for checked criteria
  const prdPath = join(workDir, "PRD.md");
  if (deps.fileExists(prdPath)) {
    const prd = deps.readFile(prdPath);
    if (prd.ok && countCheckedCriteria(prd.value) >= MIN_CHECKED_CRITERIA) {
      return true;
    }
  }

  return false;
}

function isTimestampFresh(path: string, maxAgeMs: number, deps: ArticleWriterDeps): boolean {
  const s = deps.stat(path);
  if (!s.ok) return false;
  return (Date.now() - s.value.mtimeMs) < maxAgeMs;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, ".claude");

const defaultDeps: ArticleWriterDeps = {
  fileExists,
  readFile,
  readJson,
  writeFile,
  removeFile,
  ensureDir,
  stat,
  spawnBackground,
  getISOTimestamp,
  baseDir: BASE_DIR,
  websiteRepo: process.env.PAI_WEBSITE_REPO || "",
  principalName: getPrincipalName(),
  daName: getDAName(),
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const ArticleWriter: SyncHookContract<
  SessionEndInput,
  SilentOutput,
  ArticleWriterDeps
> = {
  name: "ArticleWriter",
  event: "SessionEnd",

  accepts(input: SessionEndInput): boolean {
    return !!input.session_id;
  },

  execute(
    input: SessionEndInput,
    deps: ArticleWriterDeps,
  ): Result<SilentOutput, PaiError> {
    // Gate 1: Website repo must exist on disk
    if (!hasWebsiteRepo(deps)) {
      deps.stderr("[ArticleWriter] Website repo not found, skipping");
      return ok({ type: "silent" });
    }

    const articlesDir = join(deps.baseDir, "MEMORY/ARTICLES");
    const lockPath = join(articlesDir, ".writing");

    // Gate 2: Lock file (prevents concurrent agents)
    if (deps.fileExists(lockPath)) {
      if (isTimestampFresh(lockPath, LOCK_STALE_MS, deps)) {
        deps.stderr("[ArticleWriter] Agent already running (lock fresh), skipping");
        return ok({ type: "silent" });
      }
      deps.stderr("[ArticleWriter] Cleaning up stale lock file");
      deps.removeFile(lockPath);
    }

    // Gate 3: Substance — session must have real work with checked criteria
    if (!sessionHadSubstantialWork(input.session_id, deps.baseDir, deps)) {
      deps.stderr("[ArticleWriter] Session had no substantial work, skipping");
      return ok({ type: "silent" });
    }

    // Ensure articles directory
    const ensureResult = deps.ensureDir(articlesDir);
    if (!ensureResult.ok) {
      deps.stderr(`[ArticleWriter] Failed to create articles dir: ${ensureResult.error.message}`);
      return ok({ type: "silent" });
    }

    // Write lock
    const lockResult = deps.writeFile(lockPath, deps.getISOTimestamp());
    if (!lockResult.ok) {
      deps.stderr(`[ArticleWriter] Failed to write lock: ${lockResult.error.message}`);
      return ok({ type: "silent" });
    }

    // Spawn wrapper
    const wrapperPath = join(deps.baseDir, "pai-hooks/runners/article-writer-runner.ts");
    deps.spawnBackground("bun", [wrapperPath, deps.baseDir, input.session_id]);

    deps.stderr("[ArticleWriter] Spawned article writing agent");
    return ok({ type: "silent" });
  },

  defaultDeps,
};
