# Auto Work Creation

> Automatically create a structured work directory and requirements document when the user starts a new task.

## Problem

Every work session needs a place to store artifacts, track progress, and organize tasks. Without automatic setup, the first minutes of every session are spent creating directories and boilerplate. Agents that skip this step end up with scattered, untracked work that later hooks (progress sync, learning capture) cannot find.

## Solution

On the user's first substantive prompt, create a timestamped work directory with subdirectories for tasks and scratch space. Generate a requirements document from the prompt and initialize progress tracking. On subsequent prompts in the same session, recognize continuations and skip re-creation. Classify trivial inputs (greetings, "yes", "ok") and skip them entirely.

## How It Works

1. When the user submits a prompt, classify it as conversational (skip), new work (create), or continuation (skip).
2. For new work: generate a timestamped directory name from the current time and a slug of the prompt.
3. Create subdirectories for tasks and scratch space, plus a metadata file with session info and status.
4. Create the first task directory with a generated requirements document and an initial progress tracking file.
5. Set a symlink pointing to the current task and write a session state file so other hooks can find this work.

## Signals

- **Input:** User prompt submissions (minimum 2 characters)
- **Output:** Work directory structure (timestamped session dir, task dirs, requirements document, metadata, state file), or silent pass-through for continuations
